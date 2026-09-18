#!/usr/bin/env python3
"""Auto-finish: a show that is Ended/Canceled and fully watched becomes
'watched' on its own.

Strict on purpose — EVERY aired episode must be logged, gaps included. If you
skipped one, the show is not finished and stays where it is.

    python3 scripts/auto_finish.py            # dry run
    python3 scripts/auto_finish.py --apply
    python3 scripts/auto_finish.py --undo     # revert everything it did
"""
import os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbconn import connect

FIND = """
SELECT m.id, m.title, m.status, m.show_status,
       (SELECT COUNT(DISTINCT w.episode_id) FROM watch w
         WHERE w.media_id = m.id AND w.episode_id IS NOT NULL) AS seen
FROM media m
WHERE m.type = 'show'
  AND m.status = 'watching'
  AND m.show_status IN ('Ended', 'Canceled')
  AND EXISTS (SELECT 1 FROM watch w WHERE w.media_id = m.id)
  AND NOT EXISTS (
        SELECT 1 FROM episode e
        WHERE e.media_id = m.id AND e.season > 0
          AND e.air_date IS NOT NULL AND e.air_date <= date('now')
          AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.episode_id = e.id))
ORDER BY m.title
"""

def main():
    con = connect()
    if '--undo' in sys.argv:
        rows = con.execute(
            "SELECT id, media_id, from_status FROM status_change "
            "WHERE source='auto_finish' ORDER BY id DESC").fetchall()
        for cid, mid, prev in rows:
            con.execute("UPDATE media SET status=? WHERE id=?", (prev, mid))
            con.execute("DELETE FROM status_change WHERE id=?", (cid,))
        con.commit(); print("reverted %d auto-finished shows" % len(rows)); return

    rows = con.execute(FIND).fetchall()
    print("%d show(s) ended or canceled with every aired episode watched:\n" % len(rows))
    for _, title, _, ss, seen in rows:
        print("  %-46s %-9s %4d eps" % (title[:46], ss, seen))

    if '--apply' not in sys.argv:
        print("\ndry run — re-run with --apply"); return

    for mid, title, cur, ss, _ in rows:
        con.execute("UPDATE media SET status='watched', status_set_at=datetime('now') WHERE id=?", (mid,))
        con.execute(
            "INSERT INTO status_change (media_id, from_status, to_status, changed_at, source, reason) "
            "VALUES (?,?,?,datetime('now'),'auto_finish',?)",
            (mid, cur, 'watched', '%s, all aired episodes watched' % ss))
    con.commit()
    print("\napplied to %d shows (undo: python3 scripts/auto_finish.py --undo)" % len(rows))
    con.close()

main()
