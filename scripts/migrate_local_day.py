#!/usr/bin/env python3
"""Add watch.local_day — the calendar day in the user's own timezone.

Day-boundary stats (streak, heatmap, "what did I watch today") must use local
time. Computing it once at write time keeps it DST-correct and the SQL simple.
"""
import os, sqlite3, datetime
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB   = os.path.join(HERE, 'data', 'tracker.db')

def local_tz():
    for line in open(os.path.join(HERE, '.env')):
        if line.startswith('LOCAL_TZ='):
            return ZoneInfo(line.split('=', 1)[1].strip())
    return ZoneInfo('UTC')

TZ  = local_tz()
UTC = ZoneInfo('UTC')

def to_local_day(ts):
    d = datetime.datetime.strptime(ts, '%Y-%m-%dT%H:%M:%S.000Z').replace(tzinfo=UTC)
    return d.astimezone(TZ).date().isoformat()

con = sqlite3.connect(DB)
cols = {r[1] for r in con.execute("PRAGMA table_info(watch)")}
if 'local_day' not in cols:
    con.execute("ALTER TABLE watch ADD COLUMN local_day TEXT")
    con.execute("CREATE INDEX IF NOT EXISTS idx_watch_local_day ON watch (local_day)")

rows = con.execute("SELECT id, watched_at FROM watch WHERE local_day IS NULL").fetchall()
con.executemany("UPDATE watch SET local_day=? WHERE id=?",
                [(to_local_day(ts), i) for i, ts in rows])
con.commit()
print("populated local_day for %d rows (tz=%s)" % (len(rows), TZ))
con.close()
