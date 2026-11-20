const { createHash } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { Pool } = require('pg');

const migrationsDirectory = resolve(__dirname, '../migrations');
const lockKeys = [18241, 8];
class MigrationError extends Error {}

function manifest(directory = migrationsDirectory) {
  const names = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  if (!names.length) throw new MigrationError('No SQL migrations found');
  return names.map((name, index) => {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(name) || Number(name.slice(0, 4)) !== index + 1) {
      throw new MigrationError('Migrations must be consecutively numbered from 0001');
    }
    const sql = readFileSync(resolve(directory, name), 'utf8');
    return { version: index + 1, name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

async function status(client, migrations = manifest()) {
  const exists = await client.query("select to_regclass('public.schema_migrations') as name");
  const applied = exists.rows[0].name
    ? (await client.query('select version,name,checksum from public.schema_migrations order by version')).rows
    : [];
  for (const [index, row] of applied.entries()) {
    const expected = migrations[index];
    if (!expected || row.version !== expected.version || row.name !== expected.name || row.checksum !== expected.checksum) {
      throw new MigrationError('Migration history differs from this release; restore the matching release, never edit applied SQL');
    }
  }
  return migrations.map(m => ({ version: m.version, name: m.name, applied: m.version <= applied.length }));
}

async function assertCurrent(client) {
  if ((await status(client)).some(m => !m.applied)) {
    throw new MigrationError('Database migrations required. Back up and restore-test before running db:migrate.');
  }
}

async function transaction(client, run) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query('SET LOCAL search_path = public');
    const result = await run();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function exclusive(pool, run) {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query('select pg_try_advisory_lock($1,$2) as locked', lockKeys)).rows[0].locked;
    if (!locked) throw new MigrationError('Another migration or seed is running');
    return await run(client);
  } finally {
    try {
      if (locked) await client.query('select pg_advisory_unlock($1,$2)', lockKeys);
    } finally {
      // Destroy the session so a failed unlock cannot return a locked connection to the pool.
      client.release(true);
    }
  }
}

async function migrate(pool, migrations = manifest()) {
  return exclusive(pool, async client => {
    const current = await status(client, migrations);
    await transaction(client, () => client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version integer PRIMARY KEY, name text UNIQUE NOT NULL, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`));
    const completed = [];
    for (const migration of migrations.filter(m => !current[m.version - 1].applied)) {
      await transaction(client, async () => {
        await client.query(migration.sql);
        await client.query('insert into public.schema_migrations(version,name,checksum) values($1,$2,$3)',
          [migration.version, migration.name, migration.checksum]);
      });
      completed.push(migration.name);
    }
    return completed;
  });
}

async function seed(pool, { demo = false, env = process.env } = {}) {
  if (demo && (env.NODE_ENV === 'production' || env.ALLOW_DEMO_SEED !== 'true')) {
    throw new MigrationError('Demo seed requires ALLOW_DEMO_SEED=true outside production');
  }
  return exclusive(pool, async client => {
    await assertCurrent(client);
    if (demo && !(await client.query('select current_database() as name')).rows[0].name.endsWith('_demo')) {
      throw new MigrationError('Demo seed requires a separate database ending in _demo');
    }
    await transaction(client, async () => {
      await client.query(readFileSync(resolve(__dirname, '../seeds/reference.sql'), 'utf8'));
      if (demo) await client.query(readFileSync(resolve(__dirname, '../seeds/demo.sql'), 'utf8'));
    });
  });
}

async function main() {
  const command = process.argv[2];
  if (!['migrate', 'status', 'seed', 'seed-demo'].includes(command) || !process.env.DATABASE_URL) {
    throw new MigrationError('Set DATABASE_URL and use: database.cjs migrate|status|seed|seed-demo');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, max: 1 });
  try {
    if (command === 'status') console.log(JSON.stringify(await status(pool), null, 2));
    else if (command === 'migrate') console.log(JSON.stringify({ applied: await migrate(pool) }));
    else { await seed(pool, { demo: command === 'seed-demo' }); console.log('Seed completed'); }
  } finally { await pool.end(); }
}

module.exports = { MigrationError, manifest, status, assertCurrent, migrate, seed, lockKeys };
if (require.main === module) main().catch(error => {
  console.error(error instanceof MigrationError ? error.message : '{"event":"database_operation_failed"}');
  process.exitCode = 1;
});
