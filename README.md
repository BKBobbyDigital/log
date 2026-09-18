# LOG

A personal watch tracker.

A single-user replacement for Trakt: track what you've watched, what you're
watching, and what you want to watch — TV and movies, with artwork, air dates
and stats. No social, no recommendations, no list caps.

## Design

Two sources of truth:

| | |
|---|---|
| `media.status` | `watchlist` / `watching` / `watched` / `stopped`. **Only the user ever writes this.** |
| `watch` | append-only log of every play. Never edited, never deleted. |

Every screen is a query over those two. Nothing auto-changes your status —
a show caught up on simply falls out of Up Next and returns by itself when a
new episode airs, with its status untouched.

### Home screen
1. **Up Next** — `status=watching` with an aired, unwatched episode *after*
   your furthest point
2. **Streak** — consecutive local days with a play
3. **Calendar** — upcoming episodes for shows you're watching
4. **Watchlist** — `status=watchlist`

Plus **Needs a decision**: shows that ended or were canceled while you were
caught up. The one thing you can't notice yourself. Shown only when non-empty,
and it still never sets the status for you — it just offers the choice.

## Layout
    db/schema.sql     6 tables — SQLite now, Postgres-portable
    db/views.sql      up_next, calendar_upcoming, needs_decision,
                      watchlist_rail, episode_gaps
    db/stats.sql      watch_days, streaks
    scripts/import_trakt.py     Trakt VIP export -> DB  (--force to rebuild)
    scripts/enrich_tmdb.py      TMDB metadata + air dates (resumable)
    scripts/sync.py             nightly refresh (air dates, status, episodes)
    scripts/auto_finish.py      ended + fully watched -> watched (--undo reverts)
    scripts/test_renumber.py    proves a TMDB restructure can't corrupt history
    scripts/migrate_local_day.py, migrate_002.py, migrate_003.py
    data/tracker.db   not in git

## Gotchas worth remembering
- **Days are local, not UTC.** A 10pm watch in New York is 02:00 UTC the next
  day. Using UTC broke a 405-day streak into 99. See `watch.local_day`.
- **75% of history is backfill.** 25,209 plays were bulk-imported from Plex
  over 4 days in Dec 2023 and carry meaningless timestamps. `is_backfill=1`;
  stats exclude them so the timeline isn't one spike.
- **Up Next follows progress, not the earliest gap.** Otherwise SNL recommends
  its 1975 pilot forever.
- Re-running the importer drops all TMDB enrichment. It refuses without
  `--force`.
- **Episode matching is by `tmdb_id` first**, `(season, number)` only as a
  fallback. TMDB restructures seasons retroactively and `watch` points at
  `episode.id`; matching on numbers would silently re-attach history to the
  wrong episode. `scripts/test_renumber.py` proves it holds.
- **Duplicate plays within 5 minutes are dropped.** Rewatches append silently,
  so an accidental double-log would otherwise be invisible.
- Some TMDB ids from the Trakt export are dead (Mass Effect, 404). Sync names
  them and records a `tmdb_unreachable` row in `import_issue`.

## Nightly sync

    python3 scripts/sync.py            # refresh + auto-finish
    python3 scripts/sync.py --dry-run

Refreshes every show you follow (watching / watchlist) plus up to 150 stale
ones, then runs auto-finish. Each run is logged to `sync_run`; failures name
the title rather than incrementing a silent counter.

To schedule it on macOS, point the plist at this directory and load it:

    sed "s|REPLACE_WITH_PROJECT_PATH|$PWD|" scripts/com.log.sync.plist \
      > ~/Library/LaunchAgents/com.log.sync.plist
    launchctl load ~/Library/LaunchAgents/com.log.sync.plist

## Setup
    cp .env.example .env     # add TMDB_API_KEY and LOCAL_TZ
    python3 scripts/import_trakt.py <export_dir>
    python3 scripts/enrich_tmdb.py
    sqlite3 data/tracker.db < db/views.sql
    sqlite3 data/tracker.db < db/stats.sql
