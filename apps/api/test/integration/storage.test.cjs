require('reflect-metadata');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { BeachesService } = require('../../dist/modules/beaches/beaches.service');
const { ReportsService } = require('../../dist/modules/reports/reports.service');
const { CacheService } = require('../../dist/cache/cache.service');

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
    await pool.query(readFileSync(resolve(__dirname, '../../../../scripts/init.sql'), 'utf8'));
    const beaches = new BeachesService(pool, {});
    const result = await beaches.list(43.2409, 6.6635, 2);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, 'Plage de Pampelonne');
    assert.ok(Number(result[0].distanceKm) < 0.01);
    assert.equal(result[0].waterType, 'sea');

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
