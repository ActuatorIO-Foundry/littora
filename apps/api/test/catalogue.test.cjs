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

test('catalogue: discovery never executes schema or backfill statements', async () => {
  const statements = [];
  const service = new BeachesService({ query: async sql => {
    statements.push(sql);
    assert.match(sql, /^select /i);
    return { rows: [beach] };
  } }, { getJson: async () => [] });
  await service.discover('43,6,44,7');
  assert.ok(statements.length > 0);
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

test('catalogue: only persisted geographic classifications decide water type', async () => {
  for (const type of ['sea', 'river', 'lake', 'unknown', undefined]) {
    const row = { ...beach, name: 'Plage du Lac', department: 'Loire-Atlantique', coastline: 'Atlantique', water_type: type };
    const service = new BeachesService({ query: async () => ({ rows: [row] }) }, {});
    assert.equal((await service.get(row.id)).waterType, type ?? 'unknown');
  }
});

test('catalogue: query limits are bounded and unknown distance remains null', async () => {
  const service = new BeachesService({ query: async (_sql, values) => {
    assert.deepEqual(values, [500]);
    return { rows: [beach] };
  } }, {});
  assert.equal((await service.list(undefined, undefined, 10000))[0].distanceKm, null);
});

test('catalogue: Pays de la Loire does not imply river water', async () => {
  const service = new BeachesService({ query: async () => ({ rows: [{
    ...beach, name: 'Plage de Pornic', city: 'Pornic', department: 'Loire-Atlantique',
    region: 'Pays de la Loire', coastline: 'Atlantique',
  }] }) }, {});
  assert.equal((await service.get(beach.id)).waterType, 'sea');
});

test('catalogue: discovery is readonly even with the retired opt-in', async () => {
  const previous = process.env.CATALOGUE_DISCOVERY_ENABLED;
  process.env.CATALOGUE_DISCOVERY_ENABLED='true';
  try {
    const service = new BeachesService({ query: async sql => {
      assert.match(sql, /^select /i);
      return { rows: [beach] };
    } }, { getJson: () => assert.fail('No discovery cache or provider in readonly mode') });
    assert.equal((await service.discover('43,6,44,7')).imported, 0);
  } finally {
    if (previous === undefined) delete process.env.CATALOGUE_DISCOVERY_ENABLED;
    else process.env.CATALOGUE_DISCOVERY_ENABLED = previous;
  }
});

test('catalogue: a parking, shop, access or resort named Plage is not a beach', () => {
  const {qualify}=require('../scripts/catalogue-zone.cjs');
  for (const tags of [{ amenity: 'parking' }, { shop: 'clothes' }, { highway: 'footway' }, { leisure: 'beach_resort' }]) {
    assert.ok(qualify({ type: 'node', id: 1, lat: 43, lon: 6, tags: { name: 'La Plage', ...tags } }).reason);
  }
  assert.equal(qualify({ type: 'way', id: 2, center: { lat: 43, lon: 6 }, tags: { name: 'Plage', natural: 'beach' } }).reason,null);
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

test('nearby list: a database failure cannot turn into an arbitrary partial ranking', async () => {
  let queries = 0;
  const service = new BeachesService({ query: async () => { queries++; throw Error('storage unavailable'); } }, {});
  await assert.rejects(service.list(43,6,20), /storage unavailable/);
  assert.equal(queries,1);
});

test('discovery forwards the cursor and reports partial coverage even on the last page', async () => {
  const service = new BeachesService({});
  const next = '00000000-0000-4000-8000-000000000008';
  service.catalogue = async (after,limit,bbox) => {
    assert.equal(limit,1);assert.equal(bbox,'43,6,44,7');
    if(after !== undefined) assert.equal(after,next);
    return {beaches:[beach],nextCursor:after?null:next};
  };
  const first = await service.discover('43,6,44,7',1);
  assert.equal(first.nextCursor,next);
  const last = await service.discover('43,6,44,7',1,first.nextCursor);
  assert.equal(last.coverage,'partial');assert.equal(last.nextCursor,null);
});
