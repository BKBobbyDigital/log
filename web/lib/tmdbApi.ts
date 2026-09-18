import 'server-only';
import path from 'node:path';
import Database from 'better-sqlite3';
import { conf } from './config';

const API = 'https://api.themoviedb.org/3';
const KEY = conf('TMDB_API_KEY');

async function get<T>(pathname: string, params: Record<string, string> = {}): Promise<T | null> {
  if (!KEY) throw new Error('TMDB_API_KEY missing from .env');
  const qs = new URLSearchParams({ ...params, api_key: KEY });
  const res = await fetch(`${API}/${pathname}?${qs}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

export type SearchHit = {
  tmdb_id: number; type: 'movie' | 'show'; title: string; year: number | null;
  poster_path: string | null; overview: string | null; tmdb_rating: number | null;
  in_library: number | null;   // media.id when already present
};

type MultiResult = {
  id: number; media_type: string; title?: string; name?: string;
  release_date?: string; first_air_date?: string;
  poster_path: string | null; overview: string | null; vote_average: number | null;
  popularity: number;
};

export async function searchTmdb(query: string): Promise<SearchHit[]> {
  const data = await get<{ results: MultiResult[] }>('search/multi', {
    query, include_adult: 'false',
  });
  if (!data) return [];
  return data.results
    .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
    .map(r => {
      const date = r.release_date || r.first_air_date || '';
      return {
        tmdb_id: r.id,
        type: (r.media_type === 'tv' ? 'show' : 'movie') as 'movie' | 'show',
        title: r.title || r.name || '(untitled)',
        year: date ? Number(date.slice(0, 4)) : null,
        poster_path: r.poster_path,
        overview: r.overview,
        tmdb_rating: r.vote_average,
        in_library: null,
      };
    });
}

type ShowDetail = {
  name: string; overview: string | null; poster_path: string | null;
  backdrop_path: string | null; vote_average: number | null; status: string | null;
  first_air_date: string | null; number_of_episodes: number | null;
  episode_run_time: number[]; external_ids?: { imdb_id?: string; tvdb_id?: number };
  seasons: { season_number: number }[];
};
type MovieDetail = {
  title: string; overview: string | null; poster_path: string | null;
  backdrop_path: string | null; vote_average: number | null; runtime: number | null;
  release_date: string | null; imdb_id: string | null;
};
type SeasonDetail = {
  episodes: {
    id: number; season_number: number; episode_number: number; name: string | null;
    air_date: string | null; runtime: number | null; still_path: string | null;
  }[];
};

function openDb() {
  const db = new Database(path.join(process.cwd(), '..', 'data', 'tracker.db'));
  db.pragma('journal_mode = WAL');
  return db;
}

/** Insert a TMDB title into the library at the given status, with full
 *  metadata — and, for shows, the whole episode list so Up Next and the
 *  calendar work immediately rather than after the next nightly run. */
export async function addToLibrary(
  tmdbId: number, type: 'movie' | 'show', status: string,
): Promise<number | null> {
  const db = openDb();
  try {
    const existing = db.prepare(`SELECT id FROM media WHERE type = ? AND tmdb_id = ?`)
      .get(type, tmdbId) as { id: number } | undefined;
    if (existing) {
      db.prepare(`UPDATE media SET status = ?, status_set_at = datetime('now') WHERE id = ?`)
        .run(status, existing.id);
      return existing.id;
    }

    if (type === 'movie') {
      const d = await get<MovieDetail>(`movie/${tmdbId}`);
      if (!d) return null;
      const r = db.prepare(`
        INSERT INTO media (type, tmdb_id, imdb_id, trakt_id, title, year, status,
                           status_set_at, added_at, poster_path, backdrop_path,
                           overview, runtime, tmdb_rating, enriched_at)
        VALUES ('movie', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'),
                ?, ?, ?, ?, ?, datetime('now'))
      `).run(tmdbId, d.imdb_id, -tmdbId, d.title,
             d.release_date ? Number(d.release_date.slice(0, 4)) : null, status,
             d.poster_path, d.backdrop_path, d.overview, d.runtime, d.vote_average);
      return Number(r.lastInsertRowid);
    }

    const d = await get<ShowDetail>(`tv/${tmdbId}`, { append_to_response: 'external_ids' });
    if (!d) return null;
    const rt = d.episode_run_time?.[0] ?? null;
    const r = db.prepare(`
      INSERT INTO media (type, tmdb_id, imdb_id, tvdb_id, trakt_id, title, year, status,
                         status_set_at, added_at, poster_path, backdrop_path, overview,
                         runtime, tmdb_rating, show_status, aired_episodes, enriched_at)
      VALUES ('show', ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'),
              ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(tmdbId, d.external_ids?.imdb_id ?? null, d.external_ids?.tvdb_id ?? null,
           -tmdbId, d.name, d.first_air_date ? Number(d.first_air_date.slice(0, 4)) : null,
           status, d.poster_path, d.backdrop_path, d.overview, rt, d.vote_average,
           d.status, d.number_of_episodes);
    const mediaId = Number(r.lastInsertRowid);

    // episode list, 20 seasons per request
    const seasons = d.seasons.map(s => s.season_number);
    const ins = db.prepare(`
      INSERT OR IGNORE INTO episode (media_id, season, number, title, tmdb_id,
                                     air_date, runtime, still_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let i = 0; i < seasons.length; i += 20) {
      const chunk = seasons.slice(i, i + 20);
      const det = await get<Record<string, SeasonDetail>>(`tv/${tmdbId}`, {
        append_to_response: chunk.map(n => `season/${n}`).join(','),
      });
      if (!det) continue;
      for (const n of chunk) {
        for (const e of det[`season/${n}`]?.episodes ?? []) {
          ins.run(mediaId, e.season_number, e.episode_number, e.name, e.id,
                  e.air_date || null, e.runtime, e.still_path);
        }
      }
    }
    return mediaId;
  } finally {
    db.close();
  }
}

/** Flag search hits that are already in the library. */
export function annotateLibrary(hits: SearchHit[]): SearchHit[] {
  if (hits.length === 0) return hits;
  const db = openDb();
  try {
    const stmt = db.prepare(`SELECT id, status FROM media WHERE type = ? AND tmdb_id = ?`);
    return hits.map(h => {
      const row = stmt.get(h.type, h.tmdb_id) as { id: number } | undefined;
      return { ...h, in_library: row?.id ?? null };
    });
  } finally {
    db.close();
  }
}
