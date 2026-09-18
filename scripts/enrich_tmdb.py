#!/usr/bin/env python3
"""
Fill in TMDB metadata: artwork, runtimes, show status, and — the important
one — episode air dates, which drive Up Next and the Calendar.

Usage:
  python3 scripts/enrich_tmdb.py [--force] [--limit N] [--only shows|movies]

Resumable: skips anything already enriched unless --force.
"""
import json, os, sqlite3, sys, time, threading
import urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB   = os.path.join(HERE, 'data', 'tracker.db')
API  = 'https://api.themoviedb.org/3'
WORKERS = 8

def api_key():
    for line in open(os.path.join(HERE, '.env')):
        if line.startswith('TMDB_API_KEY='):
            return line.split('=', 1)[1].strip()
    raise SystemExit('TMDB_API_KEY not found in .env')

KEY = api_key()
_lock = threading.Lock()
_done = [0]

def get(path, **params):
    params['api_key'] = KEY
    qs = '&'.join('%s=%s' % (k, urllib.parse.quote(str(v))) for k, v in params.items())
    url = '%s/%s?%s' % (API, path, qs)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429:
                time.sleep(float(e.headers.get('Retry-After', 2)) + 0.5)
                continue
            if e.code >= 500:
                time.sleep(1 + attempt)
                continue
            return None
        except Exception:
            time.sleep(1 + attempt)
    return None

def tick(total, label):
    with _lock:
        _done[0] += 1
        if _done[0] % 50 == 0 or _done[0] == total:
            sys.stderr.write('\r  %s %d/%d' % (label, _done[0], total))
            sys.stderr.flush()

# ---------------- movies ----------------
def fetch_movie(row):
    mid, tmdb = row
    d = get('movie/%d' % tmdb)
    if not d:
        return None
    return (d.get('poster_path'), d.get('backdrop_path'), d.get('overview'),
            d.get('runtime'), d.get('vote_average'), None, None, mid)

# ---------------- shows ----------------
def fetch_show(row):
    """Returns (media_update, [episode rows]). Pulls every season via
    append_to_response, 20 at a time."""
    mid, tmdb = row
    d = get('tv/%d' % tmdb)
    if not d:
        return None
    seasons = [s['season_number'] for s in d.get('seasons', [])]
    rt = d.get('episode_run_time') or []
    upd = (d.get('poster_path'), d.get('backdrop_path'), d.get('overview'),
           rt[0] if rt else None, d.get('vote_average'),
           d.get('status'), d.get('number_of_episodes'), mid)

    eps = []
    for i in range(0, len(seasons), 20):
        chunk = seasons[i:i + 20]
        det = get('tv/%d' % tmdb, append_to_response=','.join('season/%d' % s for s in chunk))
        if not det:
            continue
        for s in chunk:
            sd = det.get('season/%d' % s)
            if not sd:
                continue
            for e in sd.get('episodes', []):
                eps.append((mid, e.get('season_number'), e.get('episode_number'),
                            e.get('name'), e.get('id'), e.get('air_date') or None,
                            e.get('runtime'), e.get('still_path')))
    return (upd, eps)

def main():
    force = '--force' in sys.argv
    only  = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None

    con = sqlite3.connect(DB)
    con.execute('PRAGMA journal_mode=WAL')
    where = '' if force else ' AND enriched_at IS NULL'

    if only != 'shows':
        rows = con.execute("SELECT id,tmdb_id FROM media WHERE type='movie' AND tmdb_id IS NOT NULL"
                           + where).fetchall()
        if limit: rows = rows[:limit]
        print('movies to enrich: %d' % len(rows))
        _done[0] = 0
        with ThreadPoolExecutor(WORKERS) as ex:
            out = []
            for r in ex.map(fetch_movie, rows):
                tick(len(rows), 'movies')
                if r: out.append(r)
        con.executemany(
            "UPDATE media SET poster_path=?,backdrop_path=?,overview=?,runtime=?,"
            "tmdb_rating=?,show_status=?,aired_episodes=COALESCE(?,aired_episodes),"
            "enriched_at=datetime('now') WHERE id=?", out)
        con.commit()
        print('\n  updated %d movies' % len(out))

    if only != 'movies':
        rows = con.execute("SELECT id,tmdb_id FROM media WHERE type='show' AND tmdb_id IS NOT NULL"
                           + where).fetchall()
        if limit: rows = rows[:limit]
        print('shows to enrich: %d' % len(rows))
        _done[0] = 0
        n_eps = 0
        with ThreadPoolExecutor(WORKERS) as ex:
            for res in ex.map(fetch_show, rows):
                tick(len(rows), 'shows')
                if not res:
                    continue
                upd, eps = res
                con.execute(
                    "UPDATE media SET poster_path=?,backdrop_path=?,overview=?,runtime=?,"
                    "tmdb_rating=?,show_status=?,aired_episodes=?,enriched_at=datetime('now') "
                    "WHERE id=?", upd)
                # insert new episodes, then fill air dates on ones we already had
                con.executemany(
                    "INSERT OR IGNORE INTO episode (media_id,season,number,title,tmdb_id,"
                    "air_date,runtime,still_path) VALUES (?,?,?,?,?,?,?,?)", eps)
                con.executemany(
                    "UPDATE episode SET air_date=COALESCE(?,air_date),runtime=COALESCE(?,runtime),"
                    "still_path=COALESCE(?,still_path),tmdb_id=COALESCE(tmdb_id,?),"
                    "title=COALESCE(title,?) WHERE media_id=? AND season=? AND number=?",
                    [(e[5], e[6], e[7], e[4], e[3], e[0], e[1], e[2]) for e in eps])
                n_eps += len(eps)
                con.commit()
        print('\n  updated %d shows, %d episode records' % (len(rows), n_eps))

    con.commit(); con.close()

if __name__ == '__main__':
    main()
