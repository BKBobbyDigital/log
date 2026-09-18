/**
 * Copy the local SQLite database to Turso.
 *
 * Schema is read from the LIVE database (sqlite_master), not from db/*.sql,
 * so the columns added by later migrations come across too — deriving it from
 * the .sql files would silently miss local_day, added_at and the rest.
 *
 *   cd web && node scripts/migrate_to_turso.mjs [--wipe]
 */
import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// web/scripts -> web -> project root
const HERE = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const env = Object.fromEntries(
  fs.readFileSync(path.join(HERE, '.env'), 'utf8').trim().split('\n').map(l => {
    const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)];
  }));

const turso = createClient({
  url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN,
});
const local = new Database(path.join(HERE, 'data', 'tracker.db'), { readonly: true });
const BATCH = 500;

const master = local.prepare(`
  SELECT type, name, sql FROM sqlite_master
  WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
`).all();

const tables  = master.filter(r => r.type === 'table');
const indexes = master.filter(r => r.type === 'index');
const views   = master.filter(r => r.type === 'view');

if (process.argv.includes('--wipe')) {
  for (const v of views)  await turso.execute(`DROP VIEW IF EXISTS ${v.name}`);
  for (const t of tables) await turso.execute(`DROP TABLE IF EXISTS ${t.name}`);
  console.log('wiped remote schema');
}

console.log(`schema: ${tables.length} tables, ${indexes.length} indexes, ${views.length} views`);
for (const t of tables)  await turso.execute(t.sql);
for (const i of indexes) await turso.execute(i.sql);
for (const v of views)   await turso.execute(v.sql);
console.log('schema created');

let grand = 0;
for (const t of tables) {
  const rows = local.prepare(`SELECT * FROM ${t.name}`).all();
  if (rows.length === 0) { console.log(`  ${t.name.padEnd(16)} 0`); continue; }
  const cols = Object.keys(rows[0]);
  const sql = `INSERT INTO ${t.name} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  for (let i = 0; i < rows.length; i += BATCH) {
    await turso.batch(
      rows.slice(i, i + BATCH).map(r => ({ sql, args: cols.map(c => r[c] ?? null) })),
      'write');
    process.stderr.write(`\r  ${t.name.padEnd(16)} ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  process.stderr.write('\n');
  grand += rows.length;
}
console.log(`\ncopied ${grand} rows`);

console.log('\nverifying:');
let ok = true;
for (const t of tables) {
  const a = local.prepare(`SELECT COUNT(*) c FROM ${t.name}`).get().c;
  const b = Number((await turso.execute(`SELECT COUNT(*) c FROM ${t.name}`)).rows[0].c);
  const match = a === b;
  if (!match) ok = false;
  console.log(`  ${t.name.padEnd(16)} local=${String(a).padEnd(7)} turso=${String(b).padEnd(7)} ${match ? 'OK' : 'MISMATCH'}`);
}
for (const v of views) {
  const a = local.prepare(`SELECT COUNT(*) c FROM ${v.name}`).get().c;
  const b = Number((await turso.execute(`SELECT COUNT(*) c FROM ${v.name}`)).rows[0].c);
  const match = a === b;
  if (!match) ok = false;
  console.log(`  view ${v.name.padEnd(11)} local=${String(a).padEnd(7)} turso=${String(b).padEnd(7)} ${match ? 'OK' : 'MISMATCH'}`);
}
console.log(ok ? '\nPASS — every table and view matches' : '\nFAILED');
local.close();
process.exit(ok ? 0 : 1);
