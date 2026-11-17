import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = require('pg');
const { migrate, seed, assertCurrent } = require('./scripts/database.cjs');

const container = process.env.POSTGRES_CONTAINER;
const dumpPath = process.env.MIGRATION_TEST_DUMP;
assert.ok(container && dumpPath, 'Set POSTGRES_CONTAINER and MIGRATION_TEST_DUMP');
const url = new URL(process.env.TEST_DATABASE_URL);
assert.equal(url.pathname, '/littora_ci_test', 'Refuse non-test PostgreSQL');
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
assert.equal(docker(['exec', container, 'printenv', 'POSTGRES_DB']).trim(), 'littora_ci_test');
const admin = new Pool({ connectionString: url.href });
const instance = randomUUID().replaceAll('-', '');
const databases = [];
const clients = [];
const dump = readFileSync(dumpPath);

async function restore(suffix) {
  const name = `littora_copy_test_${instance}_${suffix}`;
  await admin.query(`create database "${name}" template template0`);
  databases.push(name);
  const targetUrl = new URL(url);
  targetUrl.pathname = `/${name}`;
  const pool = new Pool({ connectionString: targetUrl.href });
  clients.push(pool);
  // Verify that the CLI and TCP connections point at the same disposable database.
  const marker = randomUUID();
  await pool.query('create table public.restore_target_guard(id uuid)');
  await pool.query('insert into public.restore_target_guard values($1)', [marker]);
  assert.equal(docker(['exec', container, 'psql', '-U', 'littora', '-d', name, '-XAtc', 'select id from public.restore_target_guard']).trim(), marker);
  await pool.query('drop table public.restore_target_guard');
  execFileSync('docker', ['exec', '-i', container, 'pg_restore', '-U', 'littora', '-d', name, '--exit-on-error', '--no-owner'], {
    input: dump, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  });
  return pool;
}

async function fingerprint(pool) {
  const result = {};
  for (const table of ['beaches', 'reports', 'water_quality']) {
    result[table] = (await pool.query(`select count(*)::int as count,
      md5(coalesce(string_agg((to_jsonb(t) - 'seed_key' - 'is_demo')::text, '' order by id),'')) as hash
      from public.${table} t`)).rows[0];
  }
  result.geometry = (await pool.query("select count(geom)::int as count, md5(string_agg(id::text || encode(ST_AsEWKB(geom::geometry),'hex'), '' order by id)) as hash from beaches")).rows[0];
  result.postgis = (await pool.query("select extversion from pg_extension where extname='postgis'")).rows[0].extversion;
  return result;
}

try {
  const restored = await restore('migration');
  const before = await fingerprint(restored);
  await migrate(restored);
  await seed(restored);
  await seed(restored);
  await assertCurrent(restored);
  assert.deepEqual(await fingerprint(restored), before, 'Historical data changed during migration');
  const rollback = await restore('rollback');
  assert.deepEqual(await fingerprint(rollback), before, 'Rollback restoration differs');
  console.log(JSON.stringify({ verified: true, beaches: before.beaches.count, reports: before.reports.count,
    waterQuality: before.water_quality.count, geometries: before.geometry.count, rollbackRestored: true }));
} finally {
  for (const pool of clients) await pool.end();
  try {
    for (const name of databases.reverse()) await admin.query(`drop database "${name}"`);
  } finally { await admin.end(); }
}
