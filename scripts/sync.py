#!/usr/bin/env python3
"""Nightly sync: keep air dates, show status and episode lists current.

Refreshes shows you're actually following (watching / watchlist) plus a capped
slice of anything stale. Then applies auto-finish and reports what moved.

    python3 scripts/sync.py            # normal run
    python3 scripts/sync.py --dry-run
    python3 scripts/sync.py --limit 50
"""
import json, os, sys, time, threading
import urllib.request, urllib.error, urllib.parse
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbconn import connect, tmdb_key

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB   = os.path.join(HERE, 'data', 'tracker.db')
API  = 'https://api.themoviedb.org/3'
WORKERS = 8
STALE_DAYS = 30
STALE_CAP  = 150          # never re-enrich the whole library in one night

DRY   = '--dry-run' in sys.argv
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None


KEY = tmdb_key()
_lock = threading.Lock()


def get(path, **params):
    params['api_key'] = KEY
    url = '%s/%s?%s' % (API, path, urllib.parse.urlencode(params))
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429:
                time.sleep(float(e.headers.get('Retry-After', 2)) + 0.5); continue
            if e.code >= 500:
                time.sleep(1 + attempt); continue
            return None
        except Exception:
            time.sleep(1 + attempt)
    return None


def fetch_show(row):
    """(media_id, tmdb_id) -> (media_id, show fields, [tmdb episodes])"""
    mid, tmdb = row
    d = get('tv/%d' % tmdb)
    if not d:
        return (mid, None, [])
    seasons = [s['season_number'] for s in d.get('seasons', [])]
    eps = []
    for i in range(0, len(seasons), 20):
        chunk = seasons[i:i + 20]
        det = get('tv/%d' % tmdb, append_to_response=','.join('season/%d' % s for s in chunk))
        if not det:
            continue
        for s in chunk:
            for e in (det.get('season/%d' % s) or {}).get('episodes', []):
                eps.append({
                    'tmdb_id': e.get('id'), 'season': e.get('season_number'),
                    'number': e.get('episode_number'), 'title': e.get('name'),
                    'air_date': e.get('air_date') or None, 'runtime': e.get('runtime'),
                    'still_path': e.get('still_path'),
                })
    rt = d.get('episode_run_time') or []
    return (mid, {
        'poster_path': d.get('poster_path'), 'backdrop_path': d.get('backdrop_path'),
        'overview': d.get('overview'), 'runtime': rt[0] if rt else None,
        'tmdb_rating': d.get('vote_average'), 'show_status': d.get('status'),
        'aired_episodes': d.get('number_of_episodes'),
    }, eps)


def reconcile_episodes(con, mid, tmdb_eps, stats):
    """Match on tmdb_id FIRST, (season, number) only as fallback.

    TMDB restructures seasons retroactively. watch rows point at episode.id,
    so matching purely on (season, number) would silently re-attach history to
    the wrong episode. Moves are applied via a temporary slot so the
    UNIQUE(media_id, season, number) index can't collide mid-shuffle.
    """
    by_tmdb, by_sn = {}, {}
    for eid, etmdb, s, n in con.execute(
            "SELECT id, tmdb_id, season, number FROM episode WHERE media_id = ?", (mid,)):
        if etmdb is not None:
            by_tmdb[etmdb] = (eid, s, n)
        by_sn[(s, n)] = eid

    moves, inserts, updates = [], [], []
    for e in tmdb_eps:
        if e['season'] is None or e['number'] is None:
            continue
        hit = by_tmdb.get(e['tmdb_id'])
        if hit:
            eid, s, n = hit
            if (s, n) != (e['season'], e['number']):
                moves.append((eid, e['season'], e['number'], s, n))
            updates.append((e, eid))
            continue
        eid = by_sn.get((e['season'], e['number']))
        if eid is not None:
            updates.append((e, eid))          # backfills a missing tmdb_id
        else:
            inserts.append(e)

    if DRY:
        stats['episodes_added'] += len(inserts)
        stats['episodes_moved'] += len(moves)
        return [(mid, m) for m in moves]

    # Batched deliberately: against a remote database every execute() is an
    # HTTP round trip. One statement per episode made a 9-second job take
    # 8-12 minutes regardless of where it ran.
    if moves:
        # two-phase move: park in a slot nothing else can occupy, then land
        con.executemany("UPDATE episode SET season = -1, number = -id WHERE id = ?",
                        [(eid,) for eid, _, _, _, _ in moves])
        con.executemany("UPDATE episode SET season = ?, number = ? WHERE id = ?",
                        [(s, n, eid) for eid, s, n, _, _ in moves])

    if updates:
        con.executemany("""
            UPDATE episode SET title = COALESCE(?, title), air_date = ?,
                   runtime = COALESCE(?, runtime), still_path = COALESCE(?, still_path),
                   tmdb_id = COALESCE(tmdb_id, ?)
            WHERE id = ?""",
            [(e['title'], e['air_date'], e['runtime'], e['still_path'], e['tmdb_id'], eid)
             for e, eid in updates])

    if inserts:
        con.executemany("""
            INSERT OR IGNORE INTO episode (media_id, season, number, title, tmdb_id,
                                           air_date, runtime, still_path)
            VALUES (?,?,?,?,?,?,?,?)""",
            [(mid, e['season'], e['number'], e['title'], e['tmdb_id'],
              e['air_date'], e['runtime'], e['still_path']) for e in inserts])

    stats['episodes_added'] += len(inserts)
    stats['episodes_moved'] += len(moves)
    return [(mid, m) for m in moves]


def main():
    con = connect()

    followed = con.execute("""
        SELECT id, tmdb_id FROM media
        WHERE type='show' AND tmdb_id IS NOT NULL AND status IN ('watching','watchlist')
    """).fetchall()
    stale = con.execute("""
        SELECT id, tmdb_id FROM media
        WHERE type='show' AND tmdb_id IS NOT NULL AND status NOT IN ('watching','watchlist')
          AND (enriched_at IS NULL OR enriched_at < datetime('now', ?))
        ORDER BY enriched_at LIMIT ?
    """, ('-%d day' % STALE_DAYS, STALE_CAP)).fetchall()

    targets = followed + stale
    if LIMIT:
        targets = targets[:LIMIT]
    print("sync: %d followed + %d stale = %d shows%s"
          % (len(followed), len(stale), len(targets), '  [DRY RUN]' if DRY else ''))

    run_id = None
    if not DRY:
        cur = con.execute("INSERT INTO sync_run (started_at) VALUES (datetime('now'))")
        run_id = cur.lastrowid
        con.commit()

    stats = {'shows_checked': 0, 'episodes_added': 0, 'episodes_moved': 0,
             'status_changed': 0, 'errors': 0}
    all_moves, status_changes, failures = [], [], []
    titles = dict(con.execute("SELECT id, title FROM media").fetchall())

    prev_status = dict(con.execute(
        "SELECT id, show_status FROM media WHERE type='show'").fetchall())

    with ThreadPoolExecutor(WORKERS) as ex:
        for mid, fields, eps in ex.map(fetch_show, targets):
            stats['shows_checked'] += 1
            if fields is None:
                # a dead TMDB id (404) never recovers on its own, so name it
                # rather than incrementing a counter forever
                stats['errors'] += 1
                failures.append((mid, titles.get(mid)))
                continue
            if prev_status.get(mid) != fields['show_status']:
                status_changes.append((mid, prev_status.get(mid), fields['show_status']))
                stats['status_changed'] += 1
            if not DRY:
                con.execute("""
                    UPDATE media SET poster_path=COALESCE(?,poster_path),
                           backdrop_path=COALESCE(?,backdrop_path),
                           overview=COALESCE(?,overview), runtime=COALESCE(?,runtime),
                           tmdb_rating=?, show_status=?, aired_episodes=?,
                           enriched_at=datetime('now')
                    WHERE id=?""",
                    (fields['poster_path'], fields['backdrop_path'], fields['overview'],
                     fields['runtime'], fields['tmdb_rating'], fields['show_status'],
                     fields['aired_episodes'], mid))
            all_moves += reconcile_episodes(con, mid, eps, stats)
            if not DRY and stats['shows_checked'] % 25 == 0:
                con.commit()

    if not DRY:
        con.commit()

    print("\n  shows checked   %d" % stats['shows_checked'])
    print("  episodes added  %d" % stats['episodes_added'])
    print("  episodes moved  %d" % stats['episodes_moved'])
    print("  status changed  %d" % stats['status_changed'])
    print("  errors          %d" % stats['errors'])

    if status_changes:
        print("\n  show status changes:")
        for mid, old, new in status_changes[:20]:
            t = con.execute("SELECT title FROM media WHERE id=?", (mid,)).fetchone()[0]
            print("    %-44s %s -> %s" % (t[:44], old, new))
    if failures:
        print("\n  COULD NOT FETCH (dead or changed TMDB id — needs a manual fix):")
        for mid, t in failures:
            tmdb = con.execute("SELECT tmdb_id FROM media WHERE id=?", (mid,)).fetchone()[0]
            print("    %-44s tmdb=%s" % ((t or '?')[:44], tmdb))
        if not DRY:
            for mid, t in failures:
                con.execute("DELETE FROM import_issue WHERE kind='tmdb_unreachable' AND media_id=?", (mid,))
                con.execute(
                    "INSERT INTO import_issue (kind, detail, media_id) VALUES (?,?,?)",
                    ('tmdb_unreachable', 'TMDB returned no data for "%s"' % (t or '?'), mid))
            con.commit()

    if all_moves:
        print("\n  RENUMBERED EPISODES (history follows the tmdb id, not the number):")
        for mid, (eid, s, n, olds, oldn) in all_moves[:20]:
            t = con.execute("SELECT title FROM media WHERE id=?", (mid,)).fetchone()[0]
            print("    %-36s S%sE%s -> S%sE%s" % (t[:36], olds, oldn, s, n))

    if not DRY:
        con.execute("""UPDATE sync_run SET finished_at=datetime('now'), shows_checked=?,
                       episodes_added=?, episodes_moved=?, status_changed=?, errors=?
                       WHERE id=?""",
                    (stats['shows_checked'], stats['episodes_added'], stats['episodes_moved'],
                     stats['status_changed'], stats['errors'], run_id))
        if failures:
            con.execute("UPDATE sync_run SET note=? WHERE id=?",
                        ('unreachable: ' + ', '.join((t or '?') for _, t in failures), run_id))
        con.commit()
        print("\n  logged as sync_run #%d" % run_id)

    con.close()

    if not DRY:
        print("\n--- auto-finish ---")
        sys.stdout.flush()
        os.system('%s %s --apply' % (sys.executable,
                                     os.path.join(HERE, 'scripts', 'auto_finish.py')))


if __name__ == '__main__':
    main()
