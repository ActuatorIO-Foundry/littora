require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { migrate } = require('../../scripts/database.cjs');
const { apply, review } = require('../../scripts/classify-water.cjs');
const { classificationSource, classifyPosition } = require('../../dist/modules/beaches/water-classification');
const { BeachesService } = require('../../dist/modules/beaches/beaches.service');

test('water classification: PostGIS evidence, persistence, correction and unchanged catalogue', async t => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(url.pathname, '/littora_ci_test');
  const admin = new Pool({ connectionString: url.href });
  const name = `littora_ci_water_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`create database "${name}" template template0`);
  url.pathname = '/' + name;
  const pool = new Pool({ connectionString: url.href });
  t.after(async () => {
    await pool.end();
    try { await admin.query(`drop database "${name}"`); } finally { await admin.end(); }
  });
  await migrate(pool);
  await assert.rejects(classifyPosition(pool, { lat: 0, lon: 0 }, [{ referenceId: 'invalid', layer: 'test',
    nature: 'Lac', waterType: 'lake', sourceUpdatedAt: null,
    geometry: { type: 'Polygon', coordinates: [[[0,0],[1,1],[1,0],[0,1],[0,0]]] } }]), /Invalid geographic/);
  const service = new BeachesService(pool, {});
  const sites = [
    { id: randomUUID(), name: 'Plage de La Baule', lat: 47.28, lon: -2.4, type: 'sea' },
    { id: randomUUID(), name: 'Plage de Pornic', lat: 47.11, lon: -2.1, type: 'sea' },
    { id: randomUUID(), name: 'Plage du lac sale', lat: 43.78, lon: -1.4, type: 'lake' },
    { id: randomUUID(), name: 'Berge', lat: 44.4, lon: 4.4, type: 'river' },
  ];
  const report = { version: 1, sourceUrl: classificationSource, catalogueCount: sites.length, failures: [], classifications: [] };
  for (const b of sites) {
    await pool.query("insert into beaches(id,name,lat,lon,department,region,coastline) values($1,$2,$3,$4,'Loire-Atlantique','Pays de la Loire','Atlantique')", [b.id,b.name,b.lat,b.lon]);
    assert.equal((await service.get(b.id)).waterType, 'unknown');
    const reference = { referenceId: b.id, layer: b.type === 'sea' ? 'limite_terre_mer' : 'surface_hydrographique',
      nature: b.type, waterType: b.type, sourceUpdatedAt: null,
      geometry: b.type === 'sea' ? { type: 'LineString', coordinates: [[b.lon,b.lat-0.001],[b.lon,b.lat+0.001]] }
        : { type: 'Polygon', coordinates: [[[b.lon-0.001,b.lat-0.001],[b.lon+0.001,b.lat-0.001],[b.lon+0.001,b.lat+0.001],[b.lon-0.001,b.lat-0.001]]] } };
    const decision = await classifyPosition(pool, b, [reference]);
    assert.equal(decision.waterType, b.type);
    assert.ok(decision.evidence[0].distanceMeters < 1);
    report.classifications.push({ beachId: b.id, lat: b.lat, lon: b.lon, classifiedAt: '2026-11-17T00:00:00Z', ...decision });
  }
  const snapshot = async table => (await pool.query(`select to_jsonb(t) as row from ${table} t order by 1`)).rows;
  const original = await snapshot('beaches');
  await apply(pool, report);
  const first = await snapshot('beach_water_classifications');
  const { AlertsService } = require('../../dist/modules/alerts/alerts.service');
  const vigilance = new AlertsService(pool,{ getJson:async()=>null });
  assert.equal((await vigilance.get(undefined,sites[0].id)).reason,'zone_unknown','point between the coastal and land polygons');
  assert.equal((await vigilance.get(undefined,sites[1].id)).department,'44');
  assert.equal((await vigilance.get(undefined,sites[2].id)).reason,'zone_unknown','no marine vigilance on an inland lake');
  await assert.rejects(vigilance.get('44',sites[0].id),/Choose one/);
  await assert.rejects(vigilance.get(undefined,randomUUID()),/Beach not found/);
  await apply(pool, report);
  assert.deepEqual(await snapshot('beaches'), original);
  assert.deepEqual(await snapshot('beach_water_classifications'), first);
  for (const b of sites) {
    for (const result of [await service.get(b.id), (await service.list()).find(row => row.id === b.id),
      (await service.catalogue()).beaches.find(row => row.id === b.id)]) {
      assert.equal(result.waterType, b.type);
      assert.equal(result.waterClassification.evidence[0].referenceId, b.id);
    }
  }
  await review(pool, sites[0].id, 'unknown', 'https://example.org/checked-source', 'Conflicting estuary evidence requires review');
  await apply(pool, report);
  assert.equal((await service.get(sites[0].id)).waterType, 'unknown', 'Automatic runs never overwrite a reviewed correction');
  assert.equal((await service.get(sites[0].id)).waterClassification.method, 'reviewed');
  const corrected = await snapshot('beach_water_classifications');
  const invalid = structuredClone(report);
  invalid.classifications.at(-1).lat += 1;
  await assert.rejects(apply(pool, invalid), /position changed/);
  assert.deepEqual(await snapshot('beach_water_classifications'), corrected, 'Failed application is atomic');
  await pool.query('update beaches set lat=lat+0.01 where id=$1', [sites[2].id]);
  assert.equal((await service.get(sites[2].id)).waterType, 'unknown');
  assert.equal((await service.get(sites[2].id)).waterClassification, null);
  assert.equal((await pool.query('select count(*)::int as count from beaches')).rows[0].count, sites.length);
});
