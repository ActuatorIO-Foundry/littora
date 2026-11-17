require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { migrate } = require('../../scripts/database.cjs');
const { WaterQualityService } = require('../../dist/modules/water-quality/water-quality.service');
const { scoreFixture, beach } = require('../fixtures.cjs');

test('public water quality: demo rows never mask a real sample or improve a score', async () => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(url.pathname, '/littora_ci_test', 'Refuse non-test database');
  const pool = new Pool({ connectionString: url.href });
  let client;
  try {
    await migrate(pool);
    client = await pool.connect();
    await client.query('begin');
    const id = randomUUID();
    await client.query("insert into beaches(id,name,lat,lon) values($1,'Test public data',43,6)", [id]);
    const service = new WaterQualityService(client);
    for (const [source, demo, raw] of [['demo-seed', true, {}], ['local-seed', false, {}], ['fixture', false, { demo: true }]]) {
      await client.query(`insert into water_quality(beach_id,status,source,is_demo,raw,sample_date)
        values($1,'excellent',$2,$3,$4,current_date)`, [id, source, demo, raw]);
    }
    assert.equal((await service.get(id)).status, 'unknown');
    const scoring = scoreFixture({ quality: 'unknown' });
    const expected = await scoring.scoreBeach(beach.id);
    scoring.water = { get: () => service.get(id) };
    assert.deepEqual((await scoring.scoreBeach(beach.id)).scores, expected.scores);
    await client.query(`insert into water_quality(beach_id,status,source,sample_date)
      values($1,'poor','official-test-source',current_date - 1)`, [id]);
    const real = await service.get(id);
    assert.equal(real.status, 'poor');
    assert.equal(real.provider, 'official-test-source');
    assert.ok((await scoring.scoreBeach(beach.id)).scores.bathing < expected.scores.bathing);
    assert.equal((await client.query('select count(*)::int as n from water_quality where beach_id=$1', [id])).rows[0].n, 4);
  } finally {
    if (client) { await client.query('rollback'); client.release(); }
    await pool.end();
  }
});
