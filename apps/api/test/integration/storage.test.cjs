require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { BeachesService } = require('../../dist/modules/beaches/beaches.service');
const { ReportsService } = require('../../dist/modules/reports/reports.service');
const { CacheService } = require('../../dist/cache/cache.service');
const { migrate, seed } = require('../../scripts/database.cjs');

test('isolated PostGIS catalogue, reports and Redis cache', { timeout: 30000 }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const redisUrl = process.env.TEST_REDIS_URL;
  assert.ok(databaseUrl && redisUrl, 'Set TEST_DATABASE_URL and TEST_REDIS_URL to disposable services');
  assert.equal(new URL(databaseUrl).pathname, '/littora_ci_test', 'Refuse any non-test database');
  assert.equal(new URL(redisUrl).pathname, '/15', 'Use the dedicated test Redis database 15');
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, retryStrategy: () => null });
  redis.on('error', () => {});
  const key = `littora:test:${randomUUID()}`;
  const originalRedis = process.env.REDIS_URL;
  let cache;
  try {
    await migrate(pool);
    await seed(pool);
    const beaches = new BeachesService(pool, {});
    const result = await beaches.list(43.2409, 6.6635, 2);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, 'Plage de Pampelonne');
    assert.ok(Number(result[0].distanceKm) < 0.01);
    assert.equal(result[0].waterType, 'unknown', 'Seed coordinates alone are not classification evidence');

    const outline = { type: 'Polygon', coordinates: [[[0,0],[1,0],[0,1],[0,0]]] };
    const features = [
      { osmId: `test/${randomUUID()}`, name: 'Inside commune', city: 'Test', lat: 0.2, lon: 0.2 },
      { osmId: `test/${randomUUID()}`, name: 'On boundary', city: 'Test', lat: 0, lon: 0.5 },
      { osmId: `test/${randomUUID()}`, name: 'Outside commune', city: 'Test', lat: 0.9, lon: 0.9 },
    ];
    assert.deepEqual((await beaches.featuresInGeometry(features, outline)).map(f => f.name), ['Inside commune', 'On boundary']);
    try {
      for (const feature of features) await beaches.upsertDiscoveredBeach(feature, 'Test', 'Unknown', 'Test');
      const inside = await beaches.inGeometry(outline);
      assert.equal(inside.length, 2);
      assert.equal(inside[0].has_parking, null, 'Missing amenities must remain unknown');
      assert.ok(!inside.some(row => row.name === 'Outside commune'));
      const again = await beaches.upsertDiscoveredBeach(features[0], 'Test', 'Unknown');
      assert.equal(again.id, inside.find(row => row.name === 'Inside commune').id);
    } finally {
      await pool.query('delete from beaches where osm_id = any($1::text[])', [features.map(f => f.osmId)]);
    }

    await pool.query(`insert into beaches(id,name,lat,lon,geom)
      select ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
      'Catalogue fixture ' || n,43.1,6.3,ST_SetSRID(ST_MakePoint(6.3,43.1),4326)::geography
      from generate_series(1,602) n`);
    try {
      const seen = new Set();
      let after;
      do {
        const page = await beaches.catalogue(after, 200);
        assert.ok(page.beaches.length <= 200);
        for (const row of page.beaches) { assert.ok(!seen.has(row.id)); seen.add(row.id); }
        after = page.nextCursor;
      } while (after);
      assert.equal(seen.size, Number((await pool.query('select count(*) from beaches')).rows[0].count));
      assert.ok(seen.has('10000000-0000-4000-8000-000000000602'));
      assert.equal((await beaches.catalogue(undefined, 200, '0,0,1,1')).beaches.length, 0);
    } finally {
      await pool.query("delete from beaches where id::text like '10000000-0000-4000-8000-%'");
    }

    const reports = new ReportsService(pool);
    const report = await reports.create({ beachId: result[0].id, type: 'flag', value: { flag: 'red' } });
    try {
      assert.equal(report.status, 'pending');
      assert.ok((await reports.list(result[0].id)).some((row) => row.id === report.id));
      assert.ok((await reports.flagConsensus(result[0].id)).counts.red >= 1);
      await pool.query("update reports set status='rejected' where id=$1", [report.id]);
      assert.ok(!(await reports.aggregate(result[0].id)).some((row) => row.type === 'flag'));
    } finally {
      await pool.query('delete from reports where id=$1', [report.id]);
    }

    await redis.ping();
    process.env.REDIS_URL = redisUrl;
    cache = new CacheService();
    if (cache.redis.status !== 'ready') await once(cache.redis, 'ready');
    await cache.setJson(key, { value: 0, missing: null }, 60);
    assert.deepEqual(await cache.getJson(key), { value: 0, missing: null });
    assert.ok((await redis.ttl(key)) > 0);
  } finally {
    if (originalRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedis;
    await cache?.onModuleDestroy();
    await pool.end();
    await redis.del(key).catch(() => undefined);
    redis.disconnect();
  }
});
