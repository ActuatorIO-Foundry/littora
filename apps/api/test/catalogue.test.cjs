const assert = require('node:assert/strict');
const { test } = require('node:test');
const { beach } = require('./fixtures.cjs');
const { BeachesService } = require('../dist/modules/beaches/beaches.service');
const { haversineKm } = require('../dist/shared/geo');

test('distance: zero, symmetry and kilometres', () => {
  assert.equal(haversineKm(43, 6, 43, 6), 0);
  const distance = haversineKm(0, 0, 0, 1);
  assert.ok(distance > 111 && distance < 112);
  assert.equal(distance, haversineKm(0, 1, 0, 0));
});

test('catalogue: identifiers are SQL parameters and missing beaches return 404', async () => {
  const id = "unknown' OR true --";
  const service = new BeachesService({ query: async (sql, values) => {
    assert.ok(sql.includes('where id=$1'));
    assert.ok(!sql.includes(id));
    assert.deepEqual(values, [id]);
    return { rows: [] };
  } }, {});
  await assert.rejects(service.get(id), (error) => error.getStatus() === 404);
});

test('catalogue: basic sea, river, lake and unknown classifications', async () => {
  for (const [name, coastline, expected] of [
    ['Plage de test', 'Méditerranée', 'sea'],
    ['Berge de rivière', '', 'river'],
    ['Plage du lac', '', 'lake'],
    ['Site de test', '', 'unknown'],
  ]) {
    const row = { ...beach, name, coastline, city: '', department: '', region: '' };
    const service = new BeachesService({ query: async () => ({ rows: [row] }) }, {});
    assert.equal((await service.get(row.id)).waterType, expected);
  }
});

test('catalogue: query limits are bounded and unknown distance remains null', async () => {
  const service = new BeachesService({ query: async (_sql, values) => {
    assert.deepEqual(values, [500]);
    return { rows: [beach] };
  } }, {});
  assert.equal((await service.list(undefined, undefined, 10000))[0].distanceKm, null);
});

test('catalogue: Pays de la Loire does not imply river water', {
  todo: '#13: replace geographic-name heuristics with source classification',
}, async () => {
  const service = new BeachesService({ query: async () => ({ rows: [{
    ...beach, name: 'Plage de Pornic', city: 'Pornic', department: 'Loire-Atlantique',
    region: 'Pays de la Loire', coastline: 'Atlantique',
  }] }) }, {});
  assert.equal((await service.get(beach.id)).waterType, 'sea');
});

test('catalogue: cursor pages are bounded, stable and parameterized', async () => {
  const rows = Array.from({ length: 201 }, (_, i) => ({ ...beach, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
  const service = new BeachesService({ query: async (sql, values) => {
    assert.match(sql, /order by id limit \$2/);
    assert.deepEqual(values, [null, 201, -90, -180, 90, 180]);
    return { rows };
  } }, {});
  const page = await service.catalogue();
  assert.equal(page.beaches.length, 200);
  assert.equal(page.nextCursor, rows[199].id);
  for (const limit of [0, 501, 1.5, NaN]) await assert.rejects(service.catalogue(undefined, limit), e => e.getStatus() === 400);
  await assert.rejects(service.catalogue("' or true --"), e => e.getStatus() === 400);
  await assert.rejects(service.catalogue(undefined, 200, '50,8,40,2'), e => e.getStatus() === 400);
});
