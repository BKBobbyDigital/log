#!/usr/bin/env python3
"""Schema pass 2: persist decision dismissals, track added_at, log sync runs."""
import os, sqlite3

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
con = sqlite3.connect(os.path.join(HERE, 'data', 'tracker.db'))
cols = {r[1] for r in con.execute("PRAGMA table_info(media)")}

if 'decision_dismissed_at' not in cols:
    # "Not now" must survive a reload. Storing the status it was dismissed
    # AGAINST means the prompt re-arms by itself if the show later changes
    # (e.g. Returning Series -> Canceled).
    con.execute("ALTER TABLE media ADD COLUMN decision_dismissed_at TEXT")
    con.execute("ALTER TABLE media ADD COLUMN decision_dismissed_status TEXT")

if 'added_at' not in cols:
    con.execute("ALTER TABLE media ADD COLUMN added_at TEXT")
    # best available history: first play, else when the status was set
    con.execute("""
        UPDATE media SET added_at = COALESCE(
            (SELECT MIN(watched_at) FROM watch w WHERE w.media_id = media.id),
            status_set_at)
    """)

con.execute("""
    CREATE TABLE IF NOT EXISTS sync_run (
        id             INTEGER PRIMARY KEY,
        started_at     TEXT NOT NULL,
        finished_at    TEXT,
        shows_checked  INTEGER DEFAULT 0,
        episodes_added INTEGER DEFAULT 0,
        episodes_moved INTEGER DEFAULT 0,
        status_changed INTEGER DEFAULT 0,
        errors         INTEGER DEFAULT 0,
        note           TEXT
    )
""")
con.commit()
n = con.execute("SELECT COUNT(*) FROM media WHERE added_at IS NOT NULL").fetchone()[0]
print("migrate_002 ok — added_at populated for %d of %d media" %
      (n, con.execute("SELECT COUNT(*) FROM media").fetchone()[0]))
con.close()
