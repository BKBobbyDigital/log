import 'server-only';
import { q, one } from './client';
import { localDay } from './db';

/** The library: one query, one set of filters.
 *
 *  Replaces six nav destinations that were really three status filters and
 *  three derived labels wearing the same clothes. Status is a filter here,
 *  not a place you navigate to. */

export type TypeFilter = 'all' | 'shows' | 'movies';
export type StatusFilter = 'all' | 'watchlist' | 'watching' | 'watched' | 'stopped';
export type Sort = 'recent' | 'added' | 'title' | 'year' | 'rating' | 'runtime';

export type LibraryItem = {
  media_id: number; type: 'movie' | 'show'; title: string; year: number | null;
  poster_path: string | null; runtime: number | null; tmdb_rating: number | null;
  show_status: string | null; status: string | null; my_rating: number | null;
  last_watched_at: string | null; plays: number;
  pending: number;            // aired episodes you have not watched
  next_air_date: string | null;
};

/** What is going on with this title right now — derived, never stored, never
 *  a prompt. Seeing "Ended · all watched" in the list is what replaced
 *  auto-finish, the revived prompt and dismissals. */
export function situation(i: LibraryItem): string | null {
  if (i.type === 'movie') {
    return i.plays > 1 ? `${i.plays} plays` : i.my_rating ? `★ ${i.my_rating}` : null;
  }
  if (i.pending > 0) return i.pending === 1 ? 'Up next' : `${i.pending} to watch`;
  if (i.next_air_date) {
    const days = Math.round(
      (Date.parse(i.next_air_date + 'T00:00:00Z') - Date.parse(localDay() + 'T00:00:00Z')) / 86400_000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 7) return new Date(i.next_air_date + 'T12:00:00')
      .toLocaleDateString(undefined, { weekday: 'long' });
    return `Returns ${new Date(i.next_air_date + 'T12:00:00')
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  if (i.show_status === 'Ended' || i.show_status === 'Canceled') {
    return i.status === 'watching' ? `${i.show_status} · all watched` : i.show_status;
  }
  return i.status === 'watching' ? 'Waiting' : null;
}

const SORTS: Record<Sort, string> = {
  recent:  'last_watched_at DESC, m.title COLLATE NOCASE',
  added:   'm.added_at DESC, m.title COLLATE NOCASE',
  title:   'm.title COLLATE NOCASE',
  year:    'm.year DESC, m.title COLLATE NOCASE',
  rating:  'my_rating DESC, m.title COLLATE NOCASE',
  runtime: 'm.runtime ASC, m.title COLLATE NOCASE',
};

const SELECT = `
  SELECT m.id AS media_id, m.type, m.title, m.year, m.poster_path, m.runtime,
         m.tmdb_rating, m.show_status, m.status,
         (SELECT r.rating FROM rating r
           WHERE r.media_id = m.id AND r.season IS NULL AND r.episode_id IS NULL) AS my_rating,
         (SELECT MAX(w.watched_at) FROM watch w WHERE w.media_id = m.id) AS last_watched_at,
         (SELECT COUNT(*) FROM watch w WHERE w.media_id = m.id) AS plays,
         (SELECT COUNT(*) FROM episode e
           WHERE e.media_id = m.id AND e.season > 0
             AND e.air_date IS NOT NULL AND e.air_date <= :today
             AND (e.season * 100000 + e.number) >
                 COALESCE((SELECT MAX(e2.season * 100000 + e2.number)
                           FROM watch w2 JOIN episode e2 ON e2.id = w2.episode_id
                           WHERE w2.media_id = m.id AND e2.season > 0), -1)
             AND NOT EXISTS (SELECT 1 FROM watch w3 WHERE w3.episode_id = e.id)) AS pending,
         (SELECT MIN(e.air_date) FROM episode e
           WHERE e.media_id = m.id AND e.season > 0 AND e.air_date > :today) AS next_air_date
  FROM media m`;

type Query = {
  q?: string; type?: TypeFilter; status?: StatusFilter;
  sort?: Sort; limit?: number; offset?: number;
};

/** Builds the WHERE clause and ONLY the args it actually references —
 *  libSQL rejects a named parameter the query does not use. :today belongs to
 *  the SELECT list, so callers that need it add it themselves. */
function where(f: Query) {
  const args: Record<string, string | number> = {};
  const parts: string[] = [];
  if (f.type && f.type !== 'all') {
    parts.push('m.type = :mtype');
    args.mtype = f.type === 'shows' ? 'show' : 'movie';
  }
  if (f.status && f.status !== 'all') {
    parts.push('m.status = :mstatus');
    args.mstatus = f.status;
  }
  if (f.q?.trim()) {
    parts.push('m.title LIKE :q');
    args.q = `%${f.q.trim()}%`;
  }
  return { clause: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', args };
}

export async function getLibrary(f: Query): Promise<LibraryItem[]> {
  const { clause, args } = where(f);
  const order = SORTS[f.sort ?? 'recent'];
  return q<LibraryItem>(
    `${SELECT}${clause} ORDER BY ${order} LIMIT :limit OFFSET :offset`,
    { ...args, today: localDay(), limit: f.limit ?? 60, offset: f.offset ?? 0 });
}

export async function countLibrary(f: Query): Promise<number> {
  const { clause, args } = where(f);
  const r = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM media m${clause}`, args);
  return r?.n ?? 0;
}

/** Counts per status, for the filter chips. */
export async function statusCounts(type: TypeFilter, search?: string) {
  const { clause, args } = where({ type, q: search });
  const rows = await q<{ status: string | null; n: number }>(
    `SELECT m.status, COUNT(*) AS n FROM media m${clause} GROUP BY m.status`, args);
  const out: Record<string, number> = { all: 0 };
  for (const r of rows) {
    out[r.status ?? 'none'] = r.n;
    out.all += r.n;
  }
  return out;
}


// ─── history ─────────────────────────────────────────────────────────────────

export type HistoryRow = {
  id: number; watched_at: string; local_day: string; is_backfill: number;
  media_id: number; type: 'movie' | 'show'; title: string; poster_path: string | null;
  season: number | null; number: number | null; episode_title: string | null;
};

/** Every play, newest first.
 *
 *  Backfill is excluded by default: 25,209 of 33,191 plays were bulk-imported
 *  across four days in Dec 2023 and carry meaningless timestamps. Including
 *  them by default would bury three years of real viewing under one wall. */
export async function getHistory(
  type: TypeFilter = 'all', includeBackfill = false, limit = 100, offset = 0,
): Promise<HistoryRow[]> {
  const args: (string | number)[] = [];
  const where: string[] = [];
  if (!includeBackfill) where.push('w.is_backfill = 0');
  if (type !== 'all') { where.push('m.type = ?'); args.push(type === 'shows' ? 'show' : 'movie'); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return q<HistoryRow>(`
    SELECT w.id, w.watched_at, w.local_day, w.is_backfill,
           m.id AS media_id, m.type, m.title, m.poster_path,
           e.season, e.number, e.title AS episode_title
    FROM watch w
    JOIN media m ON m.id = w.media_id
    LEFT JOIN episode e ON e.id = w.episode_id
    ${clause}
    ORDER BY w.watched_at DESC
    LIMIT ? OFFSET ?`, [...args, limit, offset]);
}

export async function countHistory(type: TypeFilter = 'all', includeBackfill = false) {
  const args: (string | number)[] = [];
  const where: string[] = [];
  if (!includeBackfill) where.push('w.is_backfill = 0');
  if (type !== 'all') { where.push('m.type = ?'); args.push(type === 'shows' ? 'show' : 'movie'); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM watch w JOIN media m ON m.id = w.media_id ${clause}`, args);
  return r?.n ?? 0;
}
