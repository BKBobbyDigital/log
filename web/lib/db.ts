import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = path.join(process.cwd(), '..', 'data', 'tracker.db');

// Read LOCAL_TZ from the project .env so JS and the Python scripts agree on
// where a day starts. Day boundaries must be local — see README.
export const LOCAL_TZ = (() => {
  try {
    const env = fs.readFileSync(path.join(process.cwd(), '..', '.env'), 'utf8');
    const m = env.match(/^LOCAL_TZ=(.+)$/m);
    return m ? m[1].trim() : 'UTC';
  } catch {
    return 'UTC';
  }
})();

let _db: Database.Database | null = null;
function db() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
  }
  return _db;
}

export function localDay(d = new Date()): string {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: LOCAL_TZ }).format(d);
}

export type MediaType = 'movie' | 'show';
export type Filter = 'all' | 'shows' | 'movies';

export type UpNextItem = {
  media_id: number; show_title: string; poster_path: string | null;
  show_status: string | null; episode_id: number; season: number; number: number;
  episode_title: string | null; air_date: string; runtime: number | null;
  still_path: string | null; last_watched_at: string | null;
  never_started: number; remaining: number;
};

export type CalendarItem = {
  media_id: number; show_title: string; poster_path: string | null;
  episode_id: number; season: number; number: number; episode_title: string | null;
  air_date: string; runtime: number | null; still_path: string | null;
  days_away: number; is_premiere: number; is_finale: number;
};

export type WatchlistItem = {
  media_id: number; type: MediaType; title: string; year: number | null;
  poster_path: string | null; runtime: number | null; tmdb_rating: number | null;
  show_status: string | null; status_set_at: string | null;
};

export type RevivedItem = {
  media_id: number; title: string; poster_path: string | null;
  show_status: string | null; new_episodes: number;
  first_new_air_date: string; last_watched_at: string | null;
};

export type BetweenSeasonsItem = {
  media_id: number; title: string; poster_path: string | null;
  show_status: string | null; returns_on: string | null;
  last_watched_at: string | null;
};

export function getUpNext(): UpNextItem[] {
  return db().prepare(`
    SELECT * FROM up_next
    ORDER BY never_started ASC, last_watched_at DESC
  `).all() as UpNextItem[];
}

export function getCalendar(limit = 30): CalendarItem[] {
  return db().prepare(`
    SELECT * FROM calendar_upcoming ORDER BY air_date, show_title LIMIT ?
  `).all(limit) as CalendarItem[];
}

export function getWatchlist(filter: Filter = 'all', limit = 40): WatchlistItem[] {
  const where = filter === 'all' ? '' : `AND type = '${filter === 'shows' ? 'show' : 'movie'}'`;
  return db().prepare(`
    SELECT * FROM watchlist_rail WHERE 1=1 ${where}
    ORDER BY status_set_at DESC LIMIT ?
  `).all(limit) as WatchlistItem[];
}

/** Finished shows that have since aired new episodes. The counterpart to
 *  auto-finish — without it, a revived show would stay buried. */
export function getRevived(): RevivedItem[] {
  return db().prepare(`
    SELECT * FROM revived ORDER BY first_new_air_date DESC
  `).all() as RevivedItem[];
}

/** status=watching, caught up, not over. Label only — status is untouched. */
export function getBetweenSeasons(): BetweenSeasonsItem[] {
  return db().prepare(`
    SELECT * FROM between_seasons
    ORDER BY (returns_on IS NULL), returns_on, last_watched_at DESC
  `).all() as BetweenSeasonsItem[];
}

export function getStreak(): { length: number; started: string; ended: string } | null {
  const today = localDay();
  const yesterday = localDay(new Date(Date.now() - 86400_000));
  return db().prepare(`
    SELECT length, started, ended FROM streaks
    WHERE ended IN (?, ?) ORDER BY ended DESC LIMIT 1
  `).get(today, yesterday) as { length: number; started: string; ended: string } | undefined ?? null;
}

/** Last 7 local days, for the streak sparkline. */
export function getRecentDays(n = 7): { day: string; plays: number }[] {
  const rows = db().prepare(`
    SELECT local_day AS day, COUNT(*) AS plays FROM watch
    WHERE is_backfill = 0 AND local_day >= date(?, '-' || ? || ' day')
    GROUP BY local_day
  `).all(localDay(), n) as { day: string; plays: number }[];
  const by = new Map(rows.map(r => [r.day, r.plays]));
  const out: { day: string; plays: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = localDay(new Date(Date.now() - i * 86400_000));
    out.push({ day: d, plays: by.get(d) ?? 0 });
  }
  return out;
}

export function getStats() {
  const one = (sql: string, ...a: unknown[]) =>
    (db().prepare(sql).get(...a) as Record<string, number>);
  return {
    ...one(`SELECT
      (SELECT COUNT(*) FROM watch WHERE episode_id IS NOT NULL) AS episodes,
      (SELECT COUNT(*) FROM watch WHERE episode_id IS NULL)     AS movies,
      (SELECT COUNT(*) FROM media WHERE status='watching')      AS watching,
      (SELECT COUNT(*) FROM media WHERE status='watchlist')     AS watchlist`),
  };
}

/** Plays of the same thing closer together than this are treated as one.
 *  Rewatches append silently by design, which means an accidental double-log
 *  is invisible — a double-tap, or a server action replayed by a reload. No
 *  one rewatches an episode 5 minutes after finishing it. */
const DEDUPE_WINDOW_MINUTES = 5;

function isDuplicate(mediaId: number, episodeId: number | null, watchedAt: string): boolean {
  const row = db().prepare(`
    SELECT 1 FROM watch
    WHERE media_id = ? AND episode_id IS ?
      AND ABS(julianday(?) - julianday(watched_at)) * 24 * 60 < ?
    LIMIT 1
  `).get(mediaId, episodeId, watchedAt, DEDUPE_WINDOW_MINUTES);
  return row !== undefined;
}

/** Append a play. The log is append-only; nothing here touches media.status.
 *  Returns false when the play was suppressed as a duplicate. */
export function markWatched(mediaId: number, episodeId: number | null): boolean {
  const now = new Date();
  const watchedAt = now.toISOString().replace(/\.\d{3}Z$/, '.000Z');
  if (isDuplicate(mediaId, episodeId, watchedAt)) return false;
  db().prepare(`
    INSERT INTO watch (media_id, episode_id, watched_at, is_backfill, local_day)
    VALUES (?, ?, ?, 0, ?)
  `).run(mediaId, episodeId, watchedAt, localDay(now));
  return true;
}

/** "Not now" — records WHICH status was dismissed, so the prompt comes back
 *  by itself if the show later changes (Returning Series -> Canceled). */
export function dismissDecision(mediaId: number) {
  db().prepare(`
    UPDATE media SET decision_dismissed_at = datetime('now'),
                     decision_dismissed_status = show_status
    WHERE id = ?`).run(mediaId);
}

export function setStatus(mediaId: number, status: string | null) {
  db().prepare(`UPDATE media SET status = ?, status_set_at = datetime('now') WHERE id = ?`)
    .run(status, mediaId);
}


// ─── detail pages ────────────────────────────────────────────────────────────

export type MediaDetail = {
  id: number; type: MediaType; title: string; year: number | null;
  overview: string | null; poster_path: string | null; backdrop_path: string | null;
  runtime: number | null; tmdb_rating: number | null; show_status: string | null;
  status: string | null; status_set_at: string | null; added_at: string | null;
  tmdb_id: number | null; imdb_id: string | null;
};

export type SeasonRow = {
  season: number; episodes: number; aired: number; watched: number;
};

export type EpisodeRow = {
  id: number; season: number; number: number; title: string | null;
  air_date: string | null; runtime: number | null; still_path: string | null;
  plays: number; rating: number | null;
};

export function getMedia(id: number): MediaDetail | null {
  return db().prepare(`
    SELECT id, type, title, year, overview, poster_path, backdrop_path, runtime,
           tmdb_rating, show_status, status, status_set_at, added_at, tmdb_id, imdb_id
    FROM media WHERE id = ?
  `).get(id) as MediaDetail | undefined ?? null;
}

export function getSeasons(mediaId: number): SeasonRow[] {
  return db().prepare(`
    SELECT e.season,
           COUNT(*) AS episodes,
           SUM(CASE WHEN e.air_date IS NOT NULL AND e.air_date <= date('now') THEN 1 ELSE 0 END) AS aired,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM watch w WHERE w.episode_id = e.id) THEN 1 ELSE 0 END) AS watched
    FROM episode e WHERE e.media_id = ?
    GROUP BY e.season ORDER BY e.season
  `).all(mediaId) as SeasonRow[];
}

export function getEpisodes(mediaId: number, season: number): EpisodeRow[] {
  return db().prepare(`
    SELECT e.id, e.season, e.number, e.title, e.air_date, e.runtime, e.still_path,
           (SELECT COUNT(*) FROM watch w WHERE w.episode_id = e.id) AS plays,
           (SELECT r.rating FROM rating r WHERE r.episode_id = e.id) AS rating
    FROM episode e WHERE e.media_id = ? AND e.season = ?
    ORDER BY e.number
  `).all(mediaId, season) as EpisodeRow[];
}

/** Aggregate progress for a show: what has aired, what you've logged. */
export function getShowProgress(mediaId: number) {
  return db().prepare(`
    SELECT
      (SELECT COUNT(*) FROM episode e WHERE e.media_id = m.id AND e.season > 0
         AND e.air_date IS NOT NULL AND e.air_date <= date('now')) AS aired,
      (SELECT COUNT(DISTINCT w.episode_id) FROM watch w JOIN episode e ON e.id = w.episode_id
         WHERE w.media_id = m.id AND e.season > 0) AS watched,
      (SELECT COUNT(*) FROM watch w WHERE w.media_id = m.id) AS plays,
      (SELECT COUNT(*) FROM episode_gaps g WHERE g.media_id = m.id) AS gaps,
      (SELECT MAX(watched_at) FROM watch w WHERE w.media_id = m.id) AS last_watched_at
    FROM media m WHERE m.id = ?
  `).get(mediaId) as {
    aired: number; watched: number; plays: number; gaps: number; last_watched_at: string | null;
  };
}

export function getPlays(mediaId: number, limit = 50) {
  return db().prepare(`
    SELECT w.id, w.watched_at, w.local_day, w.is_backfill,
           e.season, e.number, e.title AS episode_title
    FROM watch w LEFT JOIN episode e ON e.id = w.episode_id
    WHERE w.media_id = ? ORDER BY w.watched_at DESC LIMIT ?
  `).all(mediaId, limit) as {
    id: number; watched_at: string; local_day: string | null; is_backfill: number;
    season: number | null; number: number | null; episode_title: string | null;
  }[];
}

export function getRating(mediaId: number): number | null {
  const r = db().prepare(
    `SELECT rating FROM rating WHERE media_id = ? AND season IS NULL AND episode_id IS NULL`
  ).get(mediaId) as { rating: number } | undefined;
  return r?.rating ?? null;
}

// ─── mutations ───────────────────────────────────────────────────────────────

/** Backdate: watched_at is built from a local day, kept consistent with local_day. */
export function markWatchedOn(
  mediaId: number, episodeId: number | null, day: string,
): boolean {
  const now = new Date();
  const time = day === localDay(now)
    ? now.toISOString().slice(11, 19)      // today -> actual time
    : '20:00:00';                          // past day -> a plausible evening
  const watchedAt = `${day}T${time}.000Z`;
  if (isDuplicate(mediaId, episodeId, watchedAt)) return false;
  db().prepare(`
    INSERT INTO watch (media_id, episode_id, watched_at, is_backfill, local_day)
    VALUES (?, ?, ?, 0, ?)
  `).run(mediaId, episodeId, watchedAt, day);
  return true;
}

/** One play per unwatched episode in the season. Aired episodes only. */
export function markSeasonWatched(mediaId: number, season: number): number {
  const rows = db().prepare(`
    SELECT e.id FROM episode e
    WHERE e.media_id = ? AND e.season = ?
      AND e.air_date IS NOT NULL AND e.air_date <= date('now')
      AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.episode_id = e.id)
  `).all(mediaId, season) as { id: number }[];
  const day = localDay();
  const stmt = db().prepare(`
    INSERT INTO watch (media_id, episode_id, watched_at, is_backfill, local_day)
    VALUES (?, ?, ?, 0, ?)`);
  const run = db().transaction((ids: { id: number }[]) => {
    for (const r of ids) stmt.run(mediaId, r.id, `${day}T20:00:00.000Z`, day);
  });
  run(rows);
  return rows.length;
}

/** The one exception to append-only: undoing a mis-tap. */
export function unmarkWatch(watchId: number) {
  db().prepare(`DELETE FROM watch WHERE id = ?`).run(watchId);
}

/** Remove the most recent play of an episode (or movie). */
export function unmarkLatest(mediaId: number, episodeId: number | null) {
  db().prepare(`
    DELETE FROM watch WHERE id = (
      SELECT id FROM watch
      WHERE media_id = ? AND episode_id IS ?
      ORDER BY watched_at DESC LIMIT 1)
  `).run(mediaId, episodeId);
}

export function setRating(mediaId: number, rating: number | null) {
  if (rating === null) {
    db().prepare(
      `DELETE FROM rating WHERE media_id = ? AND season IS NULL AND episode_id IS NULL`
    ).run(mediaId);
    return;
  }
  db().prepare(`
    INSERT INTO rating (media_id, season, episode_id, rating, rated_at)
    VALUES (?, NULL, NULL, ?, datetime('now'))
    ON CONFLICT (media_id, season, episode_id) DO UPDATE
      SET rating = excluded.rating, rated_at = excluded.rated_at
  `).run(mediaId, rating);
}

export function findByTmdb(type: MediaType, tmdbId: number): number | null {
  const r = db().prepare(`SELECT id FROM media WHERE type = ? AND tmdb_id = ?`)
    .get(type, tmdbId) as { id: number } | undefined;
  return r?.id ?? null;
}
