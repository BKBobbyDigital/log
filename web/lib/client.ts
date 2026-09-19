import 'server-only';
import { createClient, type Client, type InArgs } from '@libsql/client';
import path from 'node:path';
import { conf, looksMasked, nonAscii } from './config';

/** One client for the whole app.
 *
 *  Turso when TURSO_DATABASE_URL is set (production, and locally so dev hits
 *  the same data), otherwise the local SQLite file — which keeps the app
 *  working offline and lets the Python scripts and the app share one file. */
let _client: Client | null = null;

export function db(): Client {
  if (_client) return _client;
  const url = conf('TURSO_DATABASE_URL');
  if (url) {
    const token = conf('TURSO_AUTH_TOKEN');
    // Fail with something actionable. Unvalidated, a masked value surfaces as
    // "Cannot convert argument to a ByteString", which names neither the
    // variable nor the cause.
    for (const [name, value] of [['TURSO_DATABASE_URL', url], ['TURSO_AUTH_TOKEN', token]] as const) {
      if (looksMasked(value)) {
        throw new Error(
          `${name} contains masked characters (••••). The value saved in the ` +
          `host's dashboard is the mask, not the real value. Re-enter it with ` +
          `masking off.`);
      }
      const bad = nonAscii(value);
      if (bad) {
        throw new Error(
          `${name} has a non-ASCII character at index ${bad.index} ` +
          `(code ${bad.code}). Expected plain ASCII — re-enter the value.`);
      }
    }
    _client = createClient({ url, authToken: token });
  } else {
    _client = createClient({ url: `file:${path.join(process.cwd(), '..', 'data', 'tracker.db')}` });
  }
  return _client;
}

/** libSQL returns bigint for INTEGER columns past 2^31; normalise so callers
 *  can do arithmetic without tripping over mixed number/bigint. */
function normalise(v: unknown): unknown {
  return typeof v === 'bigint' ? Number(v) : v;
}

export async function q<T>(sql: string, args: InArgs = []): Promise<T[]> {
  const res = await db().execute({ sql, args });
  // Read columns POSITIONALLY. libSQL rows are array-like, so row['length']
  // returns the array's own length rather than a column called "length" —
  // which silently turned every streak into the column count.
  return res.rows.map(r => {
    const o: Record<string, unknown> = {};
    res.columns.forEach((c, i) => { o[c] = normalise((r as unknown as unknown[])[i]); });
    return o as T;
  });
}

export async function one<T>(sql: string, args: InArgs = []): Promise<T | null> {
  return (await q<T>(sql, args))[0] ?? null;
}

export async function run(sql: string, args: InArgs = []): Promise<void> {
  await db().execute({ sql, args });
}

export async function batch(stmts: { sql: string; args: InArgs }[]): Promise<void> {
  if (stmts.length) await db().batch(stmts, 'write');
}
