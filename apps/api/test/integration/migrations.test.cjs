require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Pool } = require('pg');
const { migrate, seed, status, assertCurrent, manifest, lockKeys } = require('../../scripts/database.cjs');
const { DatabaseModule } = require('../../dist/database/database.module');

async function isolated(t, demo = false) {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(url.pathname, '/littora_ci_test', 'Refuse non-test PostgreSQL');
  const admin = new Pool({ connectionString: url.href, max: 1 });
  const name = `littora_ci_${randomUUID().replaceAll('-', '')}${demo ? '_demo' : ''}`;
  let pool;
  try {
    await admin.query(`create database "${name}" template template0`);
    url.pathname = `/${name}`;
    pool = new Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  } catch (error) { await admin.end(); throw error; }
  t.after(async () => {
    await pool.end();
    try { await admin.query(`drop database "${name}"`); }
    finally { await admin.end(); }
  });
  return { pool, url: url.href };
}

async function snapshot(pool) {
  const result = {};
  for (const table of ['beaches', 'reports', 'water_quality']) {
    result[table] = (await pool.query(`select to_jsonb(t) - 'seed_key' - 'is_demo' as row from ${table} t order by id`)).rows;
  }
  return result;
}

test('migrations: fresh install, readonly startup guard and idempotent reference seed', async t => {
  const { pool, url } = await isolated(t);
  const factory = Reflect.getMetadata('providers', DatabaseModule)[0].useFactory;
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  try {
    await assert.rejects(factory(), /Database migrations required/);
    assert.equal((await pool.query("select to_regclass('public.schema_migrations') as name")).rows[0].name, null);
    assert.equal((await migrate(pool)).length, 7);
    assert.deepEqual(await migrate(pool), []);
    const ready = await factory();
    await ready.end();
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  }
  await seed(pool);
  const before = await snapshot(pool);
  assert.equal(before.beaches.length, 5);
  assert.equal(before.water_quality.length, 0);
  for (const { row } of before.beaches) {
    assert.ok(row.geom);
    assert.equal(row.has_parking, null);
    assert.equal(row.has_toilets, null);
    assert.equal(row.has_lifeguard, null);
  }
  await seed(pool);
  assert.deepEqual(await snapshot(pool), before);
  await assert.rejects(seed(pool, { demo: true, env: { ALLOW_DEMO_SEED: 'true' } }), /separate database/);
  assert.deepEqual(await snapshot(pool), before);
});

test('migrations: preserve historical UUIDs, duplicates, reports, samples and OSM IDs', async t => {
  const { pool } = await isolated(t);
  const historical = readFileSync(resolve(__dirname, '../fixtures/legacy-init.sql'), 'utf8');
  await pool.query(historical);
  await pool.query(historical);
  await pool.query(`insert into reports(beach_id,type,value) select id,'pollution','{"level":"reported"}' from beaches`);
  await pool.query("update beaches set osm_id = 'way/' || id::text");
  const before = await snapshot(pool);
  const extension = (await pool.query("select extversion from pg_extension where extname='postgis'")).rows;
  assert.equal(before.beaches.length, 10, 'Legacy fixture reproduces duplicates');
  await migrate(pool);
  await seed(pool);
  await seed(pool);
  assert.deepEqual(await snapshot(pool), before);
  assert.equal((await pool.query('select count(*)::int as count from beaches where seed_key is not null')).rows[0].count, 5);
  assert.equal((await pool.query('select count(*)::int as count from water_quality where is_demo')).rows[0].count, 10);
  assert.deepEqual((await pool.query("select extversion from pg_extension where extname='postgis'")).rows, extension);
  assert.equal((await status(pool)).filter(m => m.applied).length, 7);
  await assert.rejects(pool.query(`insert into beaches(name,lat,lon,osm_id) select name,lat,lon,osm_id from beaches limit 1`), e => e.code === '23505');
  await assert.rejects(pool.query(`insert into reports(beach_id,type) values($1,'flag')`, [randomUUID()]), e => e.code === '23503');
  await pool.query('set enable_seqscan = off');
  const plan = await pool.query('explain select id from beaches order by geom <-> ST_SetSRID(ST_MakePoint(6.3,43.1),4326)::geography limit 1');
  assert.match(JSON.stringify(plan.rows), /beaches_geom_idx/);
});

test('migrations: backfill only missing geometries', async t => {
  const { pool } = await isolated(t);
  await pool.query(readFileSync(resolve(__dirname, '../fixtures/legacy-init.sql'), 'utf8'));
  const first = (await pool.query('select id from beaches order by id limit 1')).rows[0].id;
  await pool.query('update beaches set geom=null where id=$1', [first]);
  await migrate(pool);
  assert.equal((await pool.query('select ST_X(geom::geometry)=lon and ST_Y(geom::geometry)=lat as valid from beaches where id=$1', [first])).rows[0].valid, true);
});

test('migrations: conflict refuses silently destructive deduplication', async t => {
  const { pool } = await isolated(t);
  await pool.query(readFileSync(resolve(__dirname, '../fixtures/legacy-init.sql'), 'utf8'));
  await pool.query('drop index beaches_osm_id_unique_idx');
  await pool.query("update beaches set osm_id='way/duplicate'");
  const before = await snapshot(pool);
  await assert.rejects(migrate(pool), e => e.code === '23505');
  assert.equal((await pool.query('select count(*)::int as count from schema_migrations')).rows[0].count, 0);
  assert.deepEqual(await snapshot(pool), before);
});

test('migrations: transactional rollback, concurrent lock and checksum protection', async t => {
  const { pool } = await isolated(t);
  await migrate(pool);
  const sql = 'CREATE TABLE must_rollback(id int); SELECT 1/0;';
  const nextVersion = manifest().length + 1;
  const broken = [...manifest(), { version: nextVersion, name: `${String(nextVersion).padStart(4,'0')}_failure.sql`, sql, checksum: createHash('sha256').update(sql).digest('hex') }];
  await assert.rejects(migrate(pool, broken), e => e.code === '22012');
  assert.equal((await pool.query("select to_regclass('public.must_rollback') as name")).rows[0].name, null);
  await assertCurrent(pool);
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1,$2)', lockKeys);
    await assert.rejects(migrate(pool), /Another migration/);
    await assert.rejects(seed(pool), /Another migration/);
  } finally {
    await client.query('select pg_advisory_unlock($1,$2)', lockKeys);
    client.release();
  }
  assert.deepEqual(await migrate(pool), []);
  await pool.query("update schema_migrations set checksum='changed' where version=1");
  await assert.rejects(migrate(pool), /history differs/);
  await assert.rejects(assertCurrent(pool), /history differs/);
});

test('seed: opt-in demo stays in a separate database and is idempotent', async t => {
  const { pool } = await isolated(t, true);
  await migrate(pool);
  const options = { demo: true, env: { ALLOW_DEMO_SEED: 'true', NODE_ENV: 'development' } };
  await seed(pool, options);
  const before = await snapshot(pool);
  assert.equal(before.water_quality.length, 5);
  const samples = (await pool.query('select * from water_quality')).rows;
  assert.ok(samples.every(row => row.is_demo && row.raw.demo && row.source === 'demo-seed'));
  await seed(pool, options);
  assert.deepEqual(await snapshot(pool), before);
});
