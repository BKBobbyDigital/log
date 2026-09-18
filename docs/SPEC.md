# LOG — system shape

Status: data layer built and validated, home screen working end-to-end.
This doc shapes everything still to come. UI polish is deliberately last.

---

## 1. Principles

Two sources of truth, and only two:

| | written by | notes |
|---|---|---|
| `media.status` | **the user, only** | `watchlist` / `watching` / `watched` / `stopped` |
| `watch` | append-only | one row per play; never edited, never deleted |

Everything else is a query. The app never changes a status on your behalf.
Where it would be useful for a status to change, the app instead *surfaces the
fact* and offers a one-tap choice (see Needs a decision).

Corollaries worth holding onto:
- A show you're caught up on falls out of Up Next on its own and returns the
  day a new episode airs. Its status never moved.
- "Dormant" is not a status. It's `watching` with nothing aired and unwatched.
- Rewatching is just another row in `watch`. Nothing special.

---

## 2. Data model

Built: `media`, `episode`, `watch`, `rating`, `import_issue`.
Views: `up_next`, `calendar_upcoming`, `needs_decision`, `watchlist_rail`,
`episode_gaps`, `watch_days`, `streaks`.

### Still needed

**`media.decision_dismissed_at`** — "Not now" on the decision strip is
currently client-side only and comes back on reload. Needs to persist, and
should re-arm if the show's `show_status` later changes.

**`media.added_at`** — when it first entered the library, for "recently added"
and for honest stats. Distinct from `status_set_at`.

**`sync_run`** — one row per nightly job run: started, finished, counts,
errors. Without it a silently failing job is invisible for months, which is
the same class of problem as the cancellation blind spot.

### Known data hazards
- **Episode renumbering.** TMDB restructures seasons retroactively. `watch`
  points at `episode.id`, so a renumber can orphan or mis-attach history.
  The nightly job must match on `tmdb_id` first and `(season, number)` only as
  a fallback, and log anything that moves.
- **Specials (season 0)** are excluded from queues and progress everywhere.
- **The Ken Burns series** has no TMDB id at all; one-off manual fix.

---

## 2b. Derived sub-labels on `watching`

Status stays `watching`. These are computed, never stored — they appear and
disappear on their own as episodes air.

| label | rule | today |
|---|---|---|
| **Up next** | an aired episode past your furthest point is unwatched | 5 |
| **Between seasons** | caught up and not over. Shows a return date when TMDB has one, otherwise just the label | 107 |

One label covers both the 28 with a known return date and the 79 without — the
date is extra detail, not a different state. It dissolves the moment an episode
airs or the show is reported Ended/Canceled.

"Up next" is not "currently airing": some entries are ended shows with episodes
still left to watch.

---

## 3. Routes

```
/                       home: Needs a decision · Up Next · Streak · Calendar · Watchlist
/up-next                full queue, drill-in from the rail
/calendar               full upcoming schedule, grouped by day
/watchlist              full watchlist, filterable
/library                everything, filter by type + status, sort, search-in-place
/show/[id]              seasons, episode list, progress, gaps, rating, status
/movie/[id]             detail, plays, rating, status
/search?q=              TMDB search -> add to library
/stats                  see §6
```

Every list route takes the same `?filter=all|shows|movies` as home.

---

## 4. Mutations

All of these are explicit user actions. None of them fire on their own.

| action | notes |
|---|---|
| `markWatched(media, episode?)` | appends one play. Works from rail, detail, calendar |
| `markWatchedAt(media, episode?, when)` | backdating — see open question Q1 |
| `markSeasonWatched(media, season)` | bulk; one play per unwatched episode |
| `unmarkWatch(watchId)` | deletes a specific play. The one exception to append-only, for fat-finger fixes |
| `setStatus(media, status)` | the only thing that writes status |
| `setRating(media, season?, episode?, 1-10)` | no prompt; see §7 |
| `addToLibrary(tmdbId, type, status)` | from search; enriches immediately |

---

## 5. Background job

Nightly, one script, idempotent, logs to `sync_run`:

1. Refresh `show_status` + `aired_episodes` for every show with status
   `watching` or `watchlist`.
2. Refresh episode lists for those shows — new episodes, air dates, stills.
   Match on `tmdb_id` first (see renumbering hazard).
3. Refresh anything with `enriched_at` older than ~30 days, oldest first,
   capped per run so it never becomes a thundering herd.
4. Record counts and errors.

Shows with status `watched` or `stopped` are not refreshed on a schedule —
they're inert. They refresh on demand if opened.

---

## 6. Stats

Organic plays only by default (`is_backfill = 0`); a toggle can include the
Dec-2023 import. All day boundaries local.

Worth having: episodes and movies over time; total time watched; most-watched
shows; rating distribution vs TMDB's; streak history and longest; days of week
/ time of day; per-year and per-month summary; first-time vs rewatch split.

Deliberately not: anything social, anything predictive, anything requiring a
second data source.

---

## 7. Decided

- **No rating prompt.** 2,157 ratings imported and displayed; rating is
  available in the `...` menu and on detail pages. Never blocks a mark-watched.
- **No custom lists.** Status covers it. Two tables to add if that changes.
- **No scrobbling / no webhooks.** Manual entry only.
- **No social, no recommendations, no collection tracking.**
- **Auto-finish is the one exception to "the app never writes status".** A show
  that is Ended/Canceled with *every* aired episode logged becomes `watched`
  by itself. Strict: one skipped episode and it stays put. Every change is
  written to `status_change` and reversible via
  `scripts/auto_finish.py --undo`. Applied to 30 shows on first run.
- **Revived is its counterpart.** A `watched` show that has since aired
  unwatched episodes is surfaced as a prompt (Resume / Stopped / Not now).
  Without it, auto-finish would bury a show that came back — the same blind
  spot in reverse. 4 shows today.
- **Duplicate plays inside 5 minutes are suppressed.** Because rewatches append
  silently, an accidental double-log is invisible — a double-tap, or a server
  action replayed by a page reload (this actually happened during testing and
  left a phantom play in the history). No one rewatches an episode 5 minutes
  after finishing it, so the window is safe. Intentional rewatches are
  untouched.
- **Gaps are not a rail.** `episode_gaps` lives on the show detail page —
  SNL alone would put 266 rows on the home screen.
- **Up Next is a preview rail**: swipeable, with drill-in to `/up-next`.

- **Backdating**: long-press the check gives Today / Yesterday / 2 days ago /
  Pick a date. One tap for the common case (logging Saturday on Monday), full
  picker behind it.
- **Rewatch**: just appends another play, no confirmation. History already has
  268 items watched more than once, up to 4x — this is normal usage, not an
  accident to guard against. Rewatch count shows on the detail page.
- **Dormant shows**: the 109 `watching` shows with nothing scheduled stay as
  they are. 30 are already flagged by the decision strip; the rest are
  returning series with no announced date — dormant, not stale. They cost
  nothing and resurface on their own.
- **Movies**: marked watched from the watchlist card and the detail page, same
  one-tap pattern as episodes.

---

## 8. Order of work

1. ~~Persist decision dismissals + `added_at` + `sync_run`~~ — done
2. ~~Show / movie detail pages~~ — done
3. ~~Search + add from TMDB~~ — done; the app no longer needs Trakt
4. ~~Mutations: backdate, bulk season, unmark, status, rating~~ — done
5. ~~Nightly job~~ — done, running on GitHub Actions against Turso
6. Stats
7. Full-list routes
8. **UI pass last** — visual polish, transitions, empty states, PWA install
