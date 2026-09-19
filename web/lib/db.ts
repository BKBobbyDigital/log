import 'server-only';
import { q, one, run, batch } from './client';
import { UP_NEXT, CALENDAR, EPISODE_GAPS } from './sql';
import { conf } from './config';

// JS and the Python scripts must agree on where a day starts — see README.
export const LOCAL_TZ = conf('LOCAL_TZ', 'UTC');

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

export type MediaDetail = {
  id: number; type: MediaType; title: string; year: number | null;
  overview: string | null; poster_path: string | null; backdrop_path: string | null;
  runtime: number | null; tmdb_rating: number | null; show_status: string | null;
  status: string | null; status_set_at: string | null; added_at: string | null;
  tmdb_id: number | null; imdb_id: string | null;
};

export type SeasonRow = { season: number; episodes: number; aired: number; watched: number };

export type EpisodeRow = {
  id: number; season: number; number: number; title: string | null;
  air_date: string | null; runtime: number | null; still_path: string | null;
  plays: number; rating: number | null;
};

// ─── home rails ──────────────────────────────────────────────────────────────

export const getUpNext = () =>
  q<UpNextItem>(`SELECT * FROM (${UP_NEXT}) ORDER BY never_started ASC, last_watched_at DESC`,
                { today: localDay() });

export async function getCalendar(limit = 30): Promise<CalendarItem[]> {
  const today = localDay();
  const rows = await q<Omit<CalendarItem, 'days_away'>>(
    `SELECT * FROM (${CALENDAR}) ORDER BY air_date, show_title LIMIT :limit`,
    { today, limit });
  // days in the viewer's timezone, not the database's
  const base = Date.parse(today + 'T00:00:00Z');
  return rows.map(r => ({
    ...r,
    days_away: Math.round((Date.parse(r.air_date + 'T00:00:00Z') - base) / 86400_000),
  }));
}

export function getWatchlist(filter: Filter = 'all', limit = 40) {
  const args: (string | number)[] = [];
  let where = '';
  if (filter !== 'all') { where = 'WHERE type = ?'; args.push(filter === 'shows' ? 'show' : 'movie'); }
  args.push(limit);
  return q<WatchlistItem>(
    `SELECT * FROM watchlist_rail ${where} ORDER BY status_set_at DESC LIMIT ?`, args);
}

export async function getStreak() {
  const today = localDay();
  const yesterday = localDay(new Date(Date.now() - 86400_000));
  return one<{ length: number; started: string; ended: string }>(
    `SELECT length, started, ended FROM streaks WHERE ended IN (?, ?) ORDER BY ended DESC LIMIT 1`,
    [today, yesterday]);
}

/** Last n local days, for the streak sparkline. */
export async function getRecentDays(n = 7) {
  const rows = await q<{ day: string; plays: number }>(
    `SELECT local_day AS day, COUNT(*) AS plays FROM watch
     WHERE is_backfill = 0 AND local_day >= date(?, '-' || ? || ' day')
     GROUP BY local_day`, [localDay(), n]);
  const by = new Map(rows.map(r => [r.day, r.plays]));
  const out: { day: string; plays: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = localDay(new Date(Date.now() - i * 86400_000));
    out.push({ day: d, plays: by.get(d) ?? 0 });
  }
  return out;
}

export async function getStats() {
  return (await one<{ episodes: number; movies: number; watching: number; watchlist: number }>(`
    SELECT
      (SELECT COUNT(*) FROM watch WHERE episode_id IS NOT NULL) AS episodes,
      (SELECT COUNT(*) FROM watch WHERE episode_id IS NULL)     AS movies,
      (SELECT COUNT(*) FROM media WHERE status='watching')      AS watching,
      (SELECT COUNT(*) FROM media WHERE status='watchlist')     AS watchlist`))!;
}

// ─── detail pages ────────────────────────────────────────────────────────────

export const getMedia = (id: number) =>
  one<MediaDetail>(`
    SELECT id, type, title, year, overview, poster_path, backdrop_path, runtime,
           tmdb_rating, show_status, status, status_set_at, added_at, tmdb_id, imdb_id
    FROM media WHERE id = ?`, [id]);

export const getSeasons = (mediaId: number) =>
  q<SeasonRow>(`
    SELECT e.season,
           COUNT(*) AS episodes,
           SUM(CASE WHEN e.air_date IS NOT NULL AND e.air_date <= :today THEN 1 ELSE 0 END) AS aired,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM watch w WHERE w.episode_id = e.id) THEN 1 ELSE 0 END) AS watched
    FROM episode e WHERE e.media_id = :mediaId
    GROUP BY e.season ORDER BY e.season`, { mediaId, today: localDay() });

export const getEpisodes = (mediaId: number, season: number) =>
  q<EpisodeRow>(`
    SELECT e.id, e.season, e.number, e.title, e.air_date, e.runtime, e.still_path,
           (SELECT COUNT(*) FROM watch w WHERE w.episode_id = e.id) AS plays,
           (SELECT r.rating FROM rating r WHERE r.episode_id = e.id) AS rating
    FROM episode e WHERE e.media_id = :mediaId AND e.season = :season
    ORDER BY e.number`, { mediaId, season });

export async function getShowProgress(mediaId: number) {
  return (await one<{
    aired: number; watched: number; plays: number; gaps: number; last_watched_at: string | null;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM episode e WHERE e.media_id = m.id AND e.season > 0
         AND e.air_date IS NOT NULL AND e.air_date <= :today) AS aired,
      (SELECT COUNT(DISTINCT w.episode_id) FROM watch w JOIN episode e ON e.id = w.episode_id
         WHERE w.media_id = m.id AND e.season > 0) AS watched,
      (SELECT COUNT(*) FROM watch w WHERE w.media_id = m.id) AS plays,
      (SELECT COUNT(*) FROM (${EPISODE_GAPS}) g WHERE g.media_id = m.id) AS gaps,
      (SELECT MAX(watched_at) FROM watch w WHERE w.media_id = m.id) AS last_watched_at
    FROM media m WHERE m.id = :mediaId`, { mediaId, today: localDay() }))!;
}

export const getPlays = (mediaId: number, limit = 50) =>
  q<{
    id: number; watched_at: string; local_day: string | null; is_backfill: number;
    season: number | null; number: number | null; episode_title: string | null;
  }>(`
    SELECT w.id, w.watched_at, w.local_day, w.is_backfill,
           e.season, e.number, e.title AS episode_title
    FROM watch w LEFT JOIN episode e ON e.id = w.episode_id
    WHERE w.media_id = ? ORDER BY w.watched_at DESC LIMIT ?`, [mediaId, limit]);

export async function getRating(mediaId: number): Promise<number | null> {
  const r = await one<{ rating: number }>(
    `SELECT rating FROM rating WHERE media_id = ? AND season IS NULL AND episode_id IS NULL`,
    [mediaId]);
  return r?.rating ?? null;
}

// ─── mutations ───────────────────────────────────────────────────────────────

/** Plays of the same thing closer together than this are treated as one.
 *  Rewatches append silently by design, which means an accidental double-log
 *  is invisible — a double-tap, or a server action replayed by a reload. No
 *  one rewatches an episode 5 minutes after finishing it. */
const DEDUPE_WINDOW_MINUTES = 5;

async function isDuplicate(
  mediaId: number, episodeId: number | null, watchedAt: string,
): Promise<boolean> {
  const row = await one(`
    SELECT 1 AS x FROM watch
    WHERE media_id = ? AND episode_id IS ?
      AND ABS(julianday(?) - julianday(watched_at)) * 24 * 60 < ?
    LIMIT 1`, [mediaId, episodeId, watchedAt, DEDUPE_WINDOW_MINUTES]);
  return row !== null;
}

/** Append a play. The log is append-only; nothing here touches media.status.
 *  Returns false when the play was suppressed as a duplicate. */
export async function markWatched(mediaId: number, episodeId: number | null): Promise<boolean> {
  const now = new Date();
  const watchedAt = now.toISOString().replace(/\.\d{3}Z$/, '.000Z');
  if (await isDuplicate(mediaId, episodeId, watchedAt)) return false;
  await run(`INSERT INTO watch (media_id, episode_id, watched_at, is_backfill, local_day)
             VALUES (?, ?, ?, 0, ?)`, [mediaId, episodeId, watchedAt, localDay(now)]);
  return true;
}

/** Backdate: watched_at is built from a local day, kept consistent with local_day. */
export async function markWatchedOn(
  mediaId: number, episodeId: number | null, day: string,
): Promise<boolean> {
  const now = new Date();
  const time = day === localDay(now)
    ? now.toISOString().slice(11, 19)      // today -> actual time
    : '20:00:00';                          // past day -> a plausible evening
  const watchedAt = `${day}T${time}.000Z`;
  if (await isDuplicate(mediaId, episodeId, watchedAt)) return false;
  await run(`INSERT INTO watch (media_id, episode_id, watched_at, is_backfill, local_day)
             VALUES (?, ?, ?, 0, ?)`, [mediaId, episodeId, watchedAt, day]);
  return true;
}

/** One play per unwatched episode in the season. Aired episodes only. */
export async function markSeasonWatched(mediaId: number, season: number): Promise<number> {
  const rows = await q<{ id: number }>(`
    SELECT e.id FROM episode e
    WHERE e.media_id = :mediaId AND e.season = :season
      AND e.air_date IS NOT NULL AND e.air_date <= :today
      AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.episode_id = e.id)`,
    { mediaId, season, today: localDay() });
  const day = localDay();
  await batch(rows.map(r => ({
    sql: `INSERT INTO watch (media_id, episode_id, watched_at, is_backfill, local_day)
          VALUES (?, ?, ?, 0, ?)`,
    args: [mediaId, r.id, `${day}T20:00:00.000Z`, day],
  })));
  return rows.length;
}

/** The one exception to append-only: undoing a mis-tap. */
export const unmarkWatch = (watchId: number) =>
  run(`DELETE FROM watch WHERE id = ?`, [watchId]);

/** Remove the most recent play of an episode (or movie). */
export const unmarkLatest = (mediaId: number, episodeId: number | null) =>
  run(`DELETE FROM watch WHERE id = (
         SELECT id FROM watch WHERE media_id = ? AND episode_id IS ?
         ORDER BY watched_at DESC LIMIT 1)`, [mediaId, episodeId]);

export const setStatus = (mediaId: number, status: string | null) =>
  run(`UPDATE media SET status = ?, status_set_at = datetime('now') WHERE id = ?`,
      [status, mediaId]);

export async function setRating(mediaId: number, rating: number | null) {
  if (rating === null) {
    await run(`DELETE FROM rating WHERE media_id = ? AND season IS NULL AND episode_id IS NULL`,
              [mediaId]);
    return;
  }
  await run(`
    INSERT INTO rating (media_id, season, episode_id, rating, rated_at)
    VALUES (?, NULL, NULL, ?, datetime('now'))
    ON CONFLICT (media_id, season, episode_id) DO UPDATE
      SET rating = excluded.rating, rated_at = excluded.rated_at`, [mediaId, rating]);
}


export async function findByTmdb(type: MediaType, tmdbId: number): Promise<number | null> {
  const r = await one<{ id: number }>(
    `SELECT id FROM media WHERE type = ? AND tmdb_id = ?`, [type, tmdbId]);
  return r?.id ?? null;
}
