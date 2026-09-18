#!/usr/bin/env python3
"""
Import a Trakt VIP data export into the local tracker DB.

Usage:  python3 scripts/import_trakt.py <export_dir> [db_path]

Idempotent: drops and rebuilds the DB from the export each run.
Status is seeded here from the Trakt status lists; after this, only the
user changes status.
"""
import json, glob, os, sqlite3, sys, collections, datetime
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA = os.path.join(HERE, 'db', 'schema.sql')

# The Dec-2023 bulk import + pre-2023 estimated dates are not real watch times.
BACKFILL_DAYS = {'2023-12-28', '2023-12-29', '2023-12-30', '2023-12-31'}
ORGANIC_FROM  = '2023-01-01'

# Trakt list id -> status. Precedence when an item appears in several lists:
# watching beats stopped beats watched beats watchlist.
STATUS_LISTS = [
    ('26638539', 'watching'),   # TV-Watching
    ('26638554', 'stopped'),    # TV-Stopped
    ('26638541', 'watched'),    # TV-Watched
    ('26641517', 'watched'),    # Movies-Watched
    ('37378953', 'watched'),    # Movies-Watched-Overflow
    ('26638552', 'watchlist'),  # TV-Want to Watch
    ('26641498', 'watchlist'),  # Movies-Want to Watch
]
PRECEDENCE = {'watching': 0, 'stopped': 1, 'watched': 2, 'watchlist': 3}


def load_all(export_dir, pattern):
    out = []
    for f in sorted(glob.glob(os.path.join(export_dir, pattern))):
        with open(f) as fh:
            out += json.load(fh)
    return out


def is_backfill(watched_at):
    return 1 if (watched_at[:10] in BACKFILL_DAYS or watched_at < ORGANIC_FROM) else 0


def local_tz():
    for line in open(os.path.join(HERE, '.env')):
        if line.startswith('LOCAL_TZ='):
            return ZoneInfo(line.split('=', 1)[1].strip())
    return ZoneInfo('UTC')


def to_local_day(ts, tz, utc=ZoneInfo('UTC')):
    d = datetime.datetime.strptime(ts, '%Y-%m-%dT%H:%M:%S.000Z').replace(tzinfo=utc)
    return d.astimezone(tz).date().isoformat()


def main(export_dir, db_path):
    if os.path.exists(db_path):
        # a rebuild throws away TMDB enrichment (hours of API calls), so make
        # the caller say so explicitly
        if '--force' not in sys.argv:
            raise SystemExit(
                "%s already exists. Rebuilding drops all TMDB enrichment.\n"
                "Re-run with --force if that is what you want." % db_path)
        os.remove(db_path)
    TZ = local_tz()
    con = sqlite3.connect(db_path)
    with open(SCHEMA) as fh:
        con.executescript(fh.read())

    # ---------- collect media from every source ----------
    # key: (type, trakt_id) -> dict of fields
    media = {}

    def note(kind, obj):
        """kind is 'movie' or 'show'; obj is a trakt media object."""
        ids = obj.get('ids', {})
        trakt = ids.get('trakt')
        if trakt is None:
            return None
        key = (kind, trakt)
        m = media.get(key)
        if m is None:
            m = media[key] = {
                'type': kind, 'trakt_id': trakt, 'tmdb_id': None, 'imdb_id': None,
                'tvdb_id': None, 'slug': None, 'title': None, 'year': None,
                'aired_episodes': None, 'status': None, 'status_set_at': None,
            }
        # fill any field we don't have yet
        for src, dst in (('tmdb', 'tmdb_id'), ('imdb', 'imdb_id'), ('tvdb', 'tvdb_id'), ('slug', 'slug')):
            if m[dst] is None and ids.get(src) is not None:
                m[dst] = ids[src]
        for f in ('title', 'year', 'aired_episodes'):
            if m.get(f) is None and obj.get(f) is not None:
                m[f] = obj[f]
        return key

    history = load_all(export_dir, 'watched-history-*.json')
    for r in history:
        if r['type'] == 'episode':
            if 'show' in r:
                note('show', r['show'])
        elif r['type'] == 'movie':
            note('movie', r['movie'])

    for pat in ('watched-shows-*.json', 'watched-movies-*.json',
                'ratings-*.json', 'lists-watchlist.json', 'lists-list-*.json'):
        for item in load_all(export_dir, pat):
            for kind in ('show', 'movie'):
                if kind in item:
                    note(kind, item[kind])

    # ---------- seed status ----------
    status_src = collections.Counter()
    conflicts = []
    for list_id, status in STATUS_LISTS:
        for item in load_all(export_dir, 'lists-list-%s-*.json' % list_id):
            kind = item['type']
            if kind not in ('show', 'movie'):
                continue
            key = (kind, item[kind]['ids']['trakt'])
            m = media.get(key)
            if m is None:
                continue
            cur = m['status']
            if cur is None:
                m['status'] = status
                m['status_set_at'] = item.get('listed_at')
                status_src[status] += 1
            elif cur != status:
                # keep the higher-precedence one
                if PRECEDENCE[status] < PRECEDENCE[cur]:
                    m['status'] = status
                    m['status_set_at'] = item.get('listed_at')
                conflicts.append((m['title'], cur, status, m['status']))

    # built-in watchlist fills anything still unset
    for item in load_all(export_dir, 'lists-watchlist.json'):
        kind = item['type']
        if kind not in ('show', 'movie'):
            continue
        m = media.get((kind, item[kind]['ids']['trakt']))
        if m is not None and m['status'] is None:
            m['status'] = 'watchlist'
            m['status_set_at'] = item.get('listed_at')
            status_src['watchlist(builtin)'] += 1

    # ---------- write media ----------
    rows = []
    for m in media.values():
        rows.append((m['type'], m['tmdb_id'], m['imdb_id'], m['tvdb_id'], m['trakt_id'],
                     m['slug'], m['title'], m['year'], m['status'], m['status_set_at'],
                     m['aired_episodes']))
    con.executemany(
        "INSERT INTO media (type,tmdb_id,imdb_id,tvdb_id,trakt_id,slug,title,year,"
        "status,status_set_at,aired_episodes) VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)

    media_id = {}
    for mid, t, tid in con.execute("SELECT id,type,trakt_id FROM media"):
        media_id[(t, tid)] = mid

    # ---------- episodes (from history) ----------
    eps = {}   # (media_id, season, number) -> fields
    for r in history:
        if r['type'] != 'episode' or 'show' not in r:
            continue
        mid = media_id.get(('show', r['show']['ids']['trakt']))
        if mid is None:
            continue
        e = r['episode']
        k = (mid, e.get('season'), e.get('number'))
        if k[1] is None or k[2] is None:
            continue
        if k not in eps:
            ids = e.get('ids', {})
            eps[k] = (mid, k[1], k[2], e.get('title'), ids.get('tmdb'),
                      ids.get('imdb'), ids.get('tvdb'), ids.get('trakt'))
    con.executemany(
        "INSERT INTO episode (media_id,season,number,title,tmdb_id,imdb_id,tvdb_id,trakt_id) "
        "VALUES (?,?,?,?,?,?,?,?)", list(eps.values()))

    ep_id = {}
    for eid, mid, s, n in con.execute("SELECT id,media_id,season,number FROM episode"):
        ep_id[(mid, s, n)] = eid

    # ---------- watches ----------
    wrows, skipped = [], 0
    for r in history:
        wa = r['watched_at']
        if r['type'] == 'movie':
            mid = media_id.get(('movie', r['movie']['ids']['trakt']))
            if mid is None:
                skipped += 1; continue
            wrows.append((mid, None, wa, is_backfill(wa), to_local_day(wa, TZ), r.get('id')))
        elif r['type'] == 'episode':
            if 'show' not in r:
                skipped += 1; continue
            mid = media_id.get(('show', r['show']['ids']['trakt']))
            e = r['episode']
            eid = ep_id.get((mid, e.get('season'), e.get('number')))
            if mid is None:
                skipped += 1; continue
            wrows.append((mid, eid, wa, is_backfill(wa), to_local_day(wa, TZ), r.get('id')))
    con.executemany(
        "INSERT OR IGNORE INTO watch (media_id,episode_id,watched_at,is_backfill,local_day,"
        "trakt_history_id) VALUES (?,?,?,?,?,?)", wrows)

    # ---------- ratings ----------
    rrows, seen = [], set()
    for item in load_all(export_dir, 'ratings-*.json'):
        t = item['type']
        kind = 'movie' if t == 'movie' else 'show'
        if kind not in item:
            continue
        mid = media_id.get((kind, item[kind]['ids']['trakt']))
        if mid is None:
            continue
        season, eid = None, None
        if t == 'season':
            season = item['season'].get('number')
        elif t == 'episode':
            e = item['episode']
            eid = ep_id.get((mid, e.get('season'), e.get('number')))
            if eid is None:
                continue
        k = (mid, season, eid)
        if k in seen:
            continue
        seen.add(k)
        rrows.append((mid, season, eid, item['rating'], item.get('rated_at')))
    con.executemany(
        "INSERT INTO rating (media_id,season,episode_id,rating,rated_at) VALUES (?,?,?,?,?)", rrows)

    # ---------- issues ----------
    issues = []
    for mid, title in con.execute(
            "SELECT id,title FROM media WHERE tmdb_id IS NULL"):
        issues.append(('no_tmdb_id', 'no TMDB id: %s' % title, mid))
    for mid, title, n in con.execute(
            "SELECT m.id,m.title,COUNT(*) FROM episode e JOIN media m ON m.id=e.media_id "
            "WHERE e.tmdb_id IS NULL GROUP BY m.id"):
        issues.append(('episode_no_tmdb_id', '%d episodes lack a TMDB id: %s' % (n, title), mid))
    for mid, title in con.execute(
            "SELECT id,title FROM media WHERE status IS NULL"):
        issues.append(('no_status', 'no status from export: %s' % title, mid))
    con.executemany("INSERT INTO import_issue (kind,detail,media_id) VALUES (?,?,?)", issues)

    con.commit()
    report(con, export_dir, skipped, conflicts, status_src)
    con.close()


def report(con, export_dir, skipped, conflicts, status_src):
    q = lambda s: con.execute(s).fetchone()[0]
    with open(os.path.join(export_dir, 'user-stats.json')) as fh:
        st = json.load(fh)

    print("\n=== IMPORTED ===")
    print("  media        %d  (%d shows, %d movies)" % (
        q("SELECT COUNT(*) FROM media"),
        q("SELECT COUNT(*) FROM media WHERE type='show'"),
        q("SELECT COUNT(*) FROM media WHERE type='movie'")))
    print("  episodes     %d" % q("SELECT COUNT(*) FROM episode"))
    print("  watches      %d  (%d backfill, %d organic)" % (
        q("SELECT COUNT(*) FROM watch"),
        q("SELECT COUNT(*) FROM watch WHERE is_backfill=1"),
        q("SELECT COUNT(*) FROM watch WHERE is_backfill=0")))
    print("  ratings      %d" % q("SELECT COUNT(*) FROM rating"))

    print("\n=== STATUS ===")
    for s, n in con.execute(
            "SELECT COALESCE(status,'(none)'),COUNT(*) FROM media GROUP BY 1 ORDER BY 2 DESC"):
        print("  %-12s %d" % (s, n))
    for s, n in con.execute(
            "SELECT type||' / '||COALESCE(status,'(none)'),COUNT(*) FROM media GROUP BY 1 ORDER BY 1"):
        print("    %-24s %d" % (s, n))

    print("\n=== VALIDATION vs Trakt's own user-stats.json ===")
    checks = [
        ("movie plays",   q("SELECT COUNT(*) FROM watch WHERE episode_id IS NULL"), st['movies']['plays']),
        ("episode plays", q("SELECT COUNT(*) FROM watch WHERE episode_id IS NOT NULL"), st['episodes']['plays']),
        ("total plays",   q("SELECT COUNT(*) FROM watch"), st['total_plays']),
        ("ratings",       q("SELECT COUNT(*) FROM rating"), st['ratings']['total']),
        ("distinct movies watched",
         q("SELECT COUNT(DISTINCT media_id) FROM watch WHERE episode_id IS NULL"), st['movies']['watched']),
    ]
    for label, got, want in checks:
        d = got - want
        print("  %-24s ours=%-7d trakt=%-7d %s" % (
            label, got, want, "OK" if d == 0 else "diff %+d" % d))

    if conflicts:
        print("\n=== STATUS CONFLICTS (item in >1 status list) ===")
        for title, a, b, kept in conflicts:
            print("  %-45s %s vs %s -> kept %s" % ((title or '?')[:45], a, b, kept))
    if skipped:
        print("\n  %d history rows skipped (unresolvable media)" % skipped)

    n_iss = q("SELECT COUNT(*) FROM import_issue")
    if n_iss:
        print("\n=== ISSUES (%d) ===" % n_iss)
        for kind, n in con.execute(
                "SELECT kind,COUNT(*) FROM import_issue GROUP BY kind ORDER BY 2 DESC"):
            print("  %-22s %d" % (kind, n))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'data', 'tracker.db'))
