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
      values($1,'poor','official-test-source',(now() at time zone 'Europe/Paris')::date - 1)`, [id]);
    const real = await service.get(id);
    assert.equal(real.status, 'poor');
    assert.equal(real.provider, 'official-test-source');
    assert.ok((await scoring.scoreBeach(beach.id)).scores.bathing < expected.scores.bathing);
    const extra = await client.query(`insert into water_quality(beach_id,status,source,sample_date)
      values($1,'excellent','other-source',(now() at time zone 'Europe/Paris')::date - 1) returning id`,[id]);
    assert.equal((await service.get(id)).lastSample.result,'poor','Conflicting same-day results retain the adverse evidence');
    await client.query('delete from water_quality where id=$1',[extra.rows[0].id]);
    await client.query('update water_quality set sample_date=current_date-180 where source=$1 and beach_id=$2',['official-test-source',id]);
    const oldPoor=await service.get(id);
    assert.equal(oldPoor.status,'unknown');assert.equal(oldPoor.lastSample.result,'poor');
    assert.deepEqual((await scoring.scoreBeach(beach.id)).scores,expected.scores);
    for (const days of [180,0]) {
      await client.query("update water_quality set status='excellent',sample_date=(now() at time zone 'Europe/Paris')::date-$1::int where source=$2 and beach_id=$3",[days,'official-test-source',id]);
      const good=await service.get(id);
      assert.equal(good.status,'unknown');assert.equal(good.lastSample.result,'excellent');assert.equal(good.lastSample.source,'official-test-source');
      assert.match(good.lastSample.date,/^\d{4}-\d{2}-\d{2}$/);
      assert.deepEqual((await scoring.scoreBeach(beach.id)).scores,expected.scores);
    }
    await client.query("update water_quality set sample_date=current_date+3 where beach_id=$1 and not is_demo",[id]);
    assert.equal((await service.get(id)).lastSample,null);
    await client.query('update water_quality set sample_date=null where beach_id=$1',[id]);
    assert.equal((await service.get(id)).lastSample,null);
    assert.equal((await client.query('select count(*)::int as n from water_quality where beach_id=$1', [id])).rows[0].n, 4);
  } finally {
    if (client) { await client.query('rollback'); client.release(); }
    await pool.end();
  }
});
