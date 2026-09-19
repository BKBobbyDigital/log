import 'server-only';
import { q, one } from './client';
import type { Filter } from './db';

/** The named views. Each is a query over (media.status, watch) — nothing here
 *  is a stored list, so none of it can rot the way hand-maintained lists do. */
export type ListSlug =
  | 'up-next' | 'airing' | 'between-seasons'
  | 'watchlist' | 'finished' | 'stopped';

type Def = {
  title: string;
  blurb: string;
  showsOnly?: boolean;
  from: string;              // FROM/WHERE fragment, aliased as m
  defaultSort: SortKey;
};

export type SortKey = 'recent' | 'title' | 'year' | 'rating' | 'runtime' | 'returns';

const SORTS: Record<SortKey, string> = {
  recent:  'last_watched_at DESC NULLS LAST, m.title',
  title:   "m.title COLLATE NOCASE",
  year:    'm.year DESC NULLS LAST, m.title',
  rating:  'my_rating DESC NULLS LAST, m.title',
  runtime: 'm.runtime ASC NULLS LAST, m.title',
  returns: 'returns_on ASC NULLS LAST, m.title',
};

export const LISTS: Record<ListSlug, Def> = {
  'up-next': {
    title: 'Up next',
    blurb: 'An episode has aired that you have not watched.',
    showsOnly: true,
    from: `FROM up_next u JOIN media m ON m.id = u.media_id`,
    defaultSort: 'recent',
  },
  'airing': {
    title: 'Airing',
    blurb: 'Caught up, and the next episode already has a date.',
    showsOnly: true,
    from: `FROM between_seasons b JOIN media m ON m.id = b.media_id
           WHERE b.returns_on IS NOT NULL`,
    defaultSort: 'returns',
  },
  'between-seasons': {
    title: 'Between seasons',
    blurb: 'Caught up, with nothing announced yet.',
    showsOnly: true,
    from: `FROM between_seasons b JOIN media m ON m.id = b.media_id
           WHERE b.returns_on IS NULL`,
    defaultSort: 'recent',
  },
  'watchlist': {
    title: 'Want to watch',
    blurb: 'Not started yet.',
    from: `FROM media m WHERE m.status = 'watchlist'`,
    defaultSort: 'recent',
  },
  'finished': {
    title: 'Finished',
    blurb: 'Watched all the way through.',
    from: `FROM media m WHERE m.status = 'watched'`,
    defaultSort: 'recent',
  },
  'stopped': {
    title: 'Stopped',
    blurb: 'Abandoned, for whatever reason.',
    from: `FROM media m WHERE m.status = 'stopped'`,
    defaultSort: 'recent',
  },
};

export type ListRow = {
  media_id: number; type: 'movie' | 'show'; title: string; year: number | null;
  poster_path: string | null; runtime: number | null; tmdb_rating: number | null;
  show_status: string | null; my_rating: number | null;
  last_watched_at: string | null; returns_on: string | null;
  next_season: number | null; next_number: number | null; next_title: string | null;
  plays: number;
};

function build(slug: ListSlug, type: Filter, sort: SortKey) {
  const def = LISTS[slug];
  const args: (string | number)[] = [];
  let where = '';
  if (type !== 'all' && !def.showsOnly) {
    where = def.from.includes('WHERE') ? ' AND m.type = ?' : ' WHERE m.type = ?';
    args.push(type === 'shows' ? 'show' : 'movie');
  }
  return { def, where, args };
}

export async function getList(
  slug: ListSlug, type: Filter = 'all', sort?: SortKey, limit = 60, offset = 0,
): Promise<ListRow[]> {
  const { def, where, args } = build(slug, type, sort ?? LISTS[slug].defaultSort);
  const order = SORTS[sort ?? def.defaultSort] ?? SORTS[def.defaultSort];
  return q<ListRow>(`
    SELECT m.id AS media_id, m.type, m.title, m.year, m.poster_path, m.runtime,
           m.tmdb_rating, m.show_status,
           (SELECT r.rating FROM rating r
             WHERE r.media_id = m.id AND r.season IS NULL AND r.episode_id IS NULL) AS my_rating,
           (SELECT MAX(w.watched_at) FROM watch w WHERE w.media_id = m.id) AS last_watched_at,
           ${slug === 'airing' || slug === 'between-seasons' ? 'b.returns_on' : 'NULL'} AS returns_on,
           ${slug === 'up-next'
             ? 'u.season AS next_season, u.number AS next_number, u.episode_title AS next_title'
             : 'NULL AS next_season, NULL AS next_number, NULL AS next_title'},
           (SELECT COUNT(*) FROM watch w WHERE w.media_id = m.id) AS plays
    ${def.from}${where}
    ORDER BY ${order}
    LIMIT ? OFFSET ?`, [...args, limit, offset]);
}

export async function countList(slug: ListSlug, type: Filter = 'all'): Promise<number> {
  const { def, where, args } = build(slug, type, LISTS[slug].defaultSort);
  const r = await one<{ n: number }>(
    `SELECT COUNT(*) AS n ${def.from}${where}`, args);
  return r?.n ?? 0;
}

/** Counts for every view at once, for the nav. */
export async function allCounts(type: Filter = 'all') {
  const out: Record<string, number> = {};
  for (const slug of Object.keys(LISTS) as ListSlug[]) {
    if (type === 'movies' && LISTS[slug].showsOnly) continue;
    out[slug] = await countList(slug, type);
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
  type: Filter = 'all', includeBackfill = false, limit = 100, offset = 0,
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

export async function countHistory(type: Filter = 'all', includeBackfill = false) {
  const args: (string | number)[] = [];
  const where: string[] = [];
  if (!includeBackfill) where.push('w.is_backfill = 0');
  if (type !== 'all') { where.push('m.type = ?'); args.push(type === 'shows' ? 'show' : 'movie'); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM watch w JOIN media m ON m.id = w.media_id ${clause}`, args);
  return r?.n ?? 0;
}
