require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PlacesService } = require('../dist/modules/places/places.service');

const contour = { type: 'Polygon', coordinates: [[[5.72,43.12],[5.78,43.12],[5.78,43.17],[5.72,43.17],[5.72,43.12]]] };
const commune = { nom: 'Bandol', code: '83009', centre: { coordinates: [5.75,43.14] },
  bbox: contour, contour, departement: { code: '83', nom: 'Var' }, region: { code: '93', nom: 'Provence' } };
const osm = { category: 'natural', type: 'beach', osm_type: 'way', osm_id: 1, name: 'Renecros', lat: '43.134', lon: '5.75' };
function fixture(t, reply, discovery = true) {
  const previousUrl = process.env.NOMINATIM_API_URL;
  process.env.NOMINATIM_API_URL = 'https://nominatim.example/search';
  t.after(() => { if (previousUrl === undefined) delete process.env.NOMINATIM_API_URL; else process.env.NOMINATIM_API_URL = previousUrl; });
  const previous = process.env.CATALOGUE_DISCOVERY_ENABLED;
  process.env.CATALOGUE_DISCOVERY_ENABLED = String(discovery);
  t.after(() => {
    if (previous === undefined) delete process.env.CATALOGUE_DISCOVERY_ENABLED;
    else process.env.CATALOGUE_DISCOVERY_ENABLED = previous;
  });
  const memory = new Map(), requests = [], imports = [];
  t.mock.method(global, 'fetch', async url => {
    requests.push(new URL(url));
    return new Response(JSON.stringify(await reply(new URL(url))), { status: 200 });
  });
  const cache = { getJson: async key => memory.get(key), setJson: async (key, value) => memory.set(key, value) };
  const beaches = { featuresInGeometry: async features => features.filter(f => f.name !== 'Outside polygon'),
    upsertDiscoveredBeach: async (...args) => imports.push(args), inGeometry: async () => [{ id: 'local' }] };
  return { service: new PlacesService(cache, beaches), requests, imports };
}

test('communes: readonly catalogue never requests or imports OSM beaches', async t => {
  const { service, requests, imports } = fixture(t, url => {
    assert.equal(url.hostname, 'geo.api.gouv.fr');
    return commune;
  }, false);
  const result = await service.catalogue('83009');
  assert.equal(result.source, 'local-catalogue');
  assert.equal(result.coverage, 'partial');
  assert.deepEqual(result.beaches, [{ id: 'local' }]);
  assert.equal(imports.length, 0);
  assert.equal(requests.length, 1);
});

test('communes: official lookup, metropolitan coverage, cache and validation', async t => {
  const { service, requests } = fixture(t, () => [commune, { ...commune, code: '97411', centre: { coordinates: [55.4,-20.9] } }]);
  assert.deepEqual(await service.search('B'), []);
  await assert.rejects(service.search({ nom: 'Bandol' }), e => e.getStatus() === 400);
  await assert.rejects(service.search('x'.repeat(81)), e => e.getStatus() === 400);
  const result = await service.search('Bandol');
  assert.equal(result.length, 1);
  assert.equal(result[0].department.code, '83');
  assert.deepEqual(result[0].bbox, [43.12,5.72,43.17,5.78]);
  await service.search('bandol');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].hostname, 'geo.api.gouv.fr');
  assert.equal(requests[0].searchParams.get('nom'), 'Bandol');
  await assert.rejects(service.get('../secret'), e => e.getStatus() === 400);
});

test('communes: catalogue imports only named beaches within the actual boundary', async t => {
  const rows = [osm, { ...osm, osm_id: 2, name: 'Casino' },
    { ...osm, osm_id: 3, name: 'Outside polygon' },
    { ...osm, osm_id: 4, category: 'amenity', type: 'parking' },
    { ...osm, osm_id: 5, lat: '45' }, { ...osm, osm_id: 6, name: '' }];
  const { service, requests, imports } = fixture(t, url => url.hostname === 'geo.api.gouv.fr' ? commune : rows);
  const result = await service.catalogue('83009');
  assert.equal(result.source, 'openstreetmap-nominatim');
  assert.equal(result.coverage, 'partial');
  assert.equal(result.capped, false);
  assert.equal(imports.length, 2);
  assert.equal(imports[0][0].city, 'Bandol');
  assert.equal(imports[0][3], 'Var');
  assert.deepEqual(result.beaches, [{ id: 'local' }]);
  assert.deepEqual(result.commune.contour, contour);
  const request = requests.find(url => url.hostname === 'nominatim.example');
  assert.equal(request.searchParams.get('bounded'), '1');
  assert.equal(request.searchParams.get('viewbox'), '5.72,43.17,5.78,43.12');
  await service.catalogue('83009');
  assert.equal(requests.length, 2, 'Both provider responses are cached');
});

test('communes: provider failure retains local results with explicit partial coverage', async t => {
  const { service, imports } = fixture(t, url => {
    if (url.hostname === 'geo.api.gouv.fr') return commune;
    throw new Error('Offline');
  });
  const result = await service.catalogue('83009');
  assert.equal(result.source, 'local-catalogue');
  assert.equal(result.collectedAt, null);
  assert.match(result.warning, /couverture partielle/);
  assert.equal(imports.length, 0);
  assert.equal(result.beaches.length, 1);
});

test('communes: invalid outlines and mismatched identifiers are rejected before import', async t => {
  const { service } = fixture(t, () => ({ ...commune, contour: { type: 'Point', coordinates: [5,43] } }));
  await assert.rejects(service.get('83009'), e => e.getStatus() === 503);
  await assert.rejects(service.get('83010'), e => e.getStatus() === 404);
});

test('communes: public Nominatim is never used to enumerate beaches even when discovery is enabled',async t=>{
  const {service,requests}=fixture(t,()=>commune);
  process.env.NOMINATIM_API_URL='https://nominatim.openstreetmap.org/search';
  assert.equal((await service.catalogue('83009')).source,'local-catalogue');
  assert.ok(requests.every(r=>r.hostname==='geo.api.gouv.fr'));
});

test('communes: concurrent requests share a bounded provider lookup', async t => {
  const { service, requests } = fixture(t, url => url.hostname === 'geo.api.gouv.fr' ? commune : [osm]);
  const results = await Promise.all([service.catalogue('83009'), service.catalogue('83009')]);
  assert.equal(results.length, 2);
  assert.equal(requests.filter(url => url.hostname === 'nominatim.example').length, 1);
});
