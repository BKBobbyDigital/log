#!/usr/bin/env python3
"""Pull Turso down into a local SQLite file.

Two jobs, because the local file was doing neither well:

  1. A real backup. Every play, rating and status lives in one hosted database
     with no second copy. Ten years of history is not reconstructable.
  2. Stop data/tracker.db being a trap. It was a stale snapshot that still
     looked authoritative, so --refresh-local rewrites it from Turso.

    python3 scripts/backup.py                  # timestamped file in data/backups/
    python3 scripts/backup.py --refresh-local  # also rewrite data/tracker.db
"""
import datetime, os, sqlite3, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbconn import connect

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def dump_to(path, src):
    if os.path.exists(path):
        os.remove(path)
    dst = sqlite3.connect(path)

    master = src.execute(
        "SELECT type, name, sql FROM sqlite_master "
        "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").fetchall()
    tables  = [r for r in master if r[0] == 'table']
    indexes = [r for r in master if r[0] == 'index']
    views   = [r for r in master if r[0] == 'view']

    for _, _, sql in tables + indexes:
        dst.execute(sql)

    total = 0
    for _, name, _ in tables:
        rows = src.execute(f"SELECT * FROM {name}").fetchall()
        if rows:
            marks = ','.join('?' * len(rows[0]))
            dst.executemany(f"INSERT INTO {name} VALUES ({marks})", rows)
        print(f"  {name:<16} {len(rows):>7}")
        total += len(rows)

    # views last: they reference the tables
    for _, _, sql in views:
        dst.execute(sql)
    dst.commit()

    print("\n  verifying:")
    ok = True
    for _, name, _ in tables:
        a = src.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
        b = dst.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
        if a != b:
            ok = False
            print(f"    {name:<16} MISMATCH remote={a} local={b}")
    # a view proves the copy is queryable, not just row-complete
    streak = dst.execute(
        "SELECT length, ended FROM streaks ORDER BY ended DESC LIMIT 1").fetchone()
    dst.close()
    print(f"    all {len(tables)} tables match" if ok else "    MISMATCHES ABOVE")
    print(f"    streak in the copy: {streak[0]} days, to {streak[1]}")
    return total, ok


def main():
    src = connect()
    stamp = datetime.datetime.now().strftime('%Y-%m-%d-%H%M')
    out_dir = os.path.join(HERE, 'data', 'backups')
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f'log-{stamp}.db')

    print(f"backing up to {os.path.relpath(path, HERE)}")
    total, ok = dump_to(path, src)
    size = os.path.getsize(path) / 1_048_576
    print(f"\n  {total} rows, {size:.1f} MB")

    if '--refresh-local' in sys.argv:
        local = os.path.join(HERE, 'data', 'tracker.db')
        print(f"\nrefreshing {os.path.relpath(local, HERE)} from Turso")
        dump_to(local, src)

    src.close()
    sys.exit(0 if ok else 1)


main()
