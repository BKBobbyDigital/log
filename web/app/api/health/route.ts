import { NextResponse } from 'next/server';
import { conf, looksMasked, nonAscii } from '@/lib/config';
import { q } from '@/lib/client';

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

  let database = 'not attempted';
  try {
    await q('SELECT 1 AS ok');
    database = 'ok';
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
    deploy, env, checks, database,
  });
}
