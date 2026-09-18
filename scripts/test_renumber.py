#!/usr/bin/env python3
"""Prove that a TMDB season restructure does NOT corrupt watch history.

Runs against a COPY of the database. The scenario: TMDB moves episodes to
different season/number slots. Because watch rows point at episode.id and we
match on tmdb_id, every play must still be attached to the same episode
afterwards — just renumbered.
"""
import os, shutil, sqlite3, sys, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'scripts'))
import sync
sync.DRY = False

src = os.path.join(HERE, 'data', 'tracker.db')
tmp = os.path.join(tempfile.mkdtemp(), 'copy.db')
shutil.copy(src, tmp)

con = sqlite3.connect(tmp)
MID = 1033  # Coulda Been Love: 7 plays across two seasons

before = con.execute("""
    SELECT w.id, w.episode_id, e.tmdb_id, e.season, e.number
    FROM watch w JOIN episode e ON e.id = w.episode_id
    WHERE w.media_id = ? ORDER BY w.id""", (MID,)).fetchall()
print("plays before:", len(before))
for w, eid, t, s, n in before:
    print("   watch %-6d episode %-6d tmdb %-9s S%dE%d" % (w, eid, t, s, n))

# What TMDB now claims: the whole show is restructured — season 1 becomes
# season 2 with numbers shifted, season 2 becomes season 3. This MUST move the
# episodes that actually carry plays, or the test proves nothing.
truth = []
for eid, tmdb, s, n in con.execute(
        "SELECT id, tmdb_id, season, number FROM episode WHERE media_id=?", (MID,)):
    truth.append({'tmdb_id': tmdb, 'season': s + 1, 'number': n + 10,
                  'title': None, 'air_date': None, 'runtime': None, 'still_path': None})

stats = {'episodes_added': 0, 'episodes_moved': 0}
moves = sync.reconcile_episodes(con, MID, truth, stats)
con.commit()
print("\nreconcile: %d moved, %d added" % (stats['episodes_moved'], stats['episodes_added']))

after = con.execute("""
    SELECT w.id, w.episode_id, e.tmdb_id, e.season, e.number
    FROM watch w JOIN episode e ON e.id = w.episode_id
    WHERE w.media_id = ? ORDER BY w.id""", (MID,)).fetchall()
print("plays after: ", len(after))
for w, eid, t, s, n in after:
    print("   watch %-6d episode %-6d tmdb %-9s S%dE%d" % (w, eid, t, s, n))

ok = True
if len(before) != len(after):
    print("\nFAIL: play count changed"); ok = False
bmap = {w: (eid, t) for w, eid, t, _, _ in before}
amap = {w: (eid, t) for w, eid, t, _, _ in after}
for w in bmap:
    if bmap[w] != amap.get(w):
        print("\nFAIL: watch %d re-attached %s -> %s" % (w, bmap[w], amap.get(w))); ok = False
moved = [(w, b, a) for w in bmap
         for b, a in [(dict((x[0], (x[3], x[4])) for x in before)[w],
                       dict((x[0], (x[3], x[4])) for x in after)[w])] if b != a]
print("\n%d play(s) now sit at a new season/number, still on the same episode row" % len(moved))
if len(moved) == 0:
    print("FAIL: no watched episode was renumbered — the test proved nothing"); ok = False
print("\n%s" % ("PASS — every play stayed attached to its own episode" if ok else "FAILED"))
con.close()
sys.exit(0 if ok else 1)
