#!/usr/bin/env python3
"""Schema pass 3: audit log for status changes.

Auto-finish is the first thing that writes media.status without the user
doing it. Every such write is logged so it can be reviewed and undone.
"""
import os, sqlite3
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
con = sqlite3.connect(os.path.join(HERE, 'data', 'tracker.db'))
con.execute("""
    CREATE TABLE IF NOT EXISTS status_change (
        id          INTEGER PRIMARY KEY,
        media_id    INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        from_status TEXT,
        to_status   TEXT,
        changed_at  TEXT NOT NULL,
        source      TEXT NOT NULL,   -- 'user' | 'auto_finish'
        reason      TEXT
    )
""")
con.execute("CREATE INDEX IF NOT EXISTS idx_status_change_media ON status_change (media_id)")
con.commit(); print("migrate_003 ok"); con.close()
