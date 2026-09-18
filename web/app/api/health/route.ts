import { NextResponse } from 'next/server';
import { conf } from '@/lib/config';
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

  let database = 'not attempted';
  try {
    await q('SELECT 1 AS ok');
    database = 'ok';
  } catch (e) {
    database = `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
  }

  return NextResponse.json({ ok: Object.values(env).every(Boolean) && database === 'ok', env, database });
}
