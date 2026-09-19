import { NextResponse } from 'next/server';
import { conf, looksMasked, nonAscii } from '@/lib/config';
import { q } from '@/lib/client';
import { UP_NEXT, CALENDAR, BETWEEN_SEASONS, REVIVED, EPISODE_GAPS } from '@/lib/sql';
import { localDay } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Deployment diagnostics. Reports whether each setting is PRESENT and whether
 *  the database answers — never any values, and no counts. Deliberately
 *  public: without it, a misconfigured deploy is only visible as a generic
 *  "Incorrect password", which cost us an hour. */
export async function GET() {
  const env = {
    APP_PASSWORD: Boolean(conf('APP_PASSWORD')),
    AUTH_SECRET: Boolean(conf('AUTH_SECRET')),
    TURSO_DATABASE_URL: Boolean(conf('TURSO_DATABASE_URL')),
    TURSO_AUTH_TOKEN: Boolean(conf('TURSO_AUTH_TOKEN')),
    TMDB_API_KEY: Boolean(conf('TMDB_API_KEY')),
    LOCAL_TZ: conf('LOCAL_TZ') || null,
  };

  // Per-value sanity: length and cleanliness only, never the value itself.
  const checks: Record<string, string> = {};
  for (const key of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'AUTH_SECRET', 'APP_PASSWORD']) {
    const v = conf(key);
    if (!v) { checks[key] = 'not set'; continue; }
    const bad = nonAscii(v);
    checks[key] = looksMasked(v)
      ? `MASKED VALUE SAVED (${v.length} chars) — re-enter with masking off`
      : bad
        ? `non-ASCII at index ${bad.index} (code ${bad.code}) — re-enter`
        : `ok (${v.length} chars)`;
  }

  // Exercise the REAL queries, not SELECT 1. A connectivity-only check
  // reported "ok" while the app's views were missing from the database --
  // it cannot fail in any way that matters.
  let database = 'not attempted';
  const views: Record<string, string> = {};
  const today = localDay();
  try {
    await q('SELECT 1 AS ok');
    database = 'ok';
    const probes: [string, string][] = [
      ['up_next', UP_NEXT], ['calendar', CALENDAR], ['between_seasons', BETWEEN_SEASONS],
      ['revived', REVIVED], ['episode_gaps', EPISODE_GAPS],
      ['watchlist', `SELECT id FROM media WHERE status = 'watchlist'`],
      ['history', `SELECT id FROM watch WHERE is_backfill = 0`],
    ];
    for (const [name, sql] of probes) {
      try {
        const rows = await q<{ n: number }>(
          `SELECT COUNT(*) AS n FROM (${sql})`, sql.includes(':today') ? { today } : []);
        views[name] = String(rows[0]?.n ?? '?');
      } catch (e) {
        views[name] = `FAILED: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120);
        database = 'degraded';
      }
    }
  } catch (e) {
    database = `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
  }

  // Which deploy is actually serving? Without this it is impossible to tell a
  // failed build from a successful one that predates an env var change --
  // both simply look like "the old values are still there".
  const deploy = {
    commit: process.env.COMMIT_REF?.slice(0, 7) ?? 'unknown',
    branch: process.env.BRANCH ?? 'unknown',
    context: process.env.CONTEXT ?? 'local',
    built_at: process.env.BUILD_TIME ?? 'unknown',
  };

  return NextResponse.json({
    ok: Object.values(env).every(Boolean) && database === 'ok',
    deploy, today, env, checks, database, views,
  });
}
