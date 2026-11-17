const assert = require('node:assert/strict');
const { test } = require('node:test');
const { referenceWaterType, decideWaterType, normalizeReferences } = require('../dist/modules/beaches/water-classification');
const { scoreFixture, beach } = require('./fixtures.cjs');
const { fetchLayer, validateReport } = require('../scripts/classify-water.cjs');
const evidence = (waterType, distanceMeters = 0) => ({ referenceId: waterType, layer: 'test', nature: 'test',
  sourceUpdatedAt: null, waterType, distanceMeters });

test('water classification: structured source attributes, never names or salinity', () => {
  const props = nature => ({ nature, etat_de_l_objet: 'En service', name: 'Lac de la Loire', salinite: true });
  assert.equal(referenceWaterType('limite_terre_mer', { niveau: 'Plus hautes eaux' }), 'sea');
  assert.equal(referenceWaterType('surface_hydrographique', props('Lac')), 'lake');
  assert.equal(referenceWaterType('surface_hydrographique', props('Ecoulement naturel')), 'river');
  for (const nature of ['Bassin', 'Réservoir-bassin', 'Canal', 'Lagune', undefined]) {
    assert.equal(referenceWaterType('surface_hydrographique', props(nature)), 'unknown');
  }
  assert.equal(referenceWaterType('other', { coastline: 'Atlantique' }), 'unknown');
  assert.equal(referenceWaterType('surface_hydrographique', { nature: 'Lac', etat_de_l_objet: 'Détruit' }), 'unknown');
});

test('water classification: zero distance, cutoff, ambiguity and unsupported bodies', () => {
  for (const type of ['sea', 'lake', 'river']) assert.equal(decideWaterType([evidence(type)]).waterType, type);
  assert.equal(decideWaterType([evidence('sea', 201)]).waterType, 'unknown');
  assert.equal(decideWaterType([evidence('sea', NaN)]).waterType, 'unknown');
  assert.equal(decideWaterType([evidence('sea', 5), evidence('river', 35)]).reason, 'ambiguous-water-bodies');
  assert.equal(decideWaterType([evidence('lake', 1), evidence('sea', 100)]).waterType, 'lake');
  assert.equal(decideWaterType([evidence('sea', 10), evidence('unknown', 20)]).waterType, 'unknown');
  assert.equal(decideWaterType([]).reason, 'no-nearby-reference');
});

test('water classification: partial or malformed reference responses fail closed', () => {
  for (const raw of [null, { type: 'FeatureCollection', features: [], totalFeatures: 1 },
    { type: 'FeatureCollection', features: [], totalFeatures: 'unknown' }]) {
    assert.throws(() => normalizeReferences('surface_hydrographique', raw), /Incomplete/);
  }
  const feature = { properties: { cleabs: 'SURF_EAU1', nature: 'Lac', etat_de_l_objet: 'En service' },
    geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[0,1],[0,0]]] } };
  const rows = normalizeReferences('surface_hydrographique', { type: 'FeatureCollection', features: [feature], totalFeatures: 1 });
  assert.equal(rows[0].waterType, 'lake');
  assert.equal(rows[0].referenceId, 'SURF_EAU1');
});

test('water classification: lake, river and unknown sites never request offshore forecasts or tides', async () => {
  for (const waterType of ['lake', 'river', 'unknown']) {
    const service = scoreFixture();
    service.beaches = { get: async () => ({ ...beach, waterType }) };
    service.marine = { get: () => assert.fail('No offshore forecast for inland/unknown water') };
    service.tides = { get: () => assert.fail('No tide query for inland/unknown water') };
    const result = await service.scoreBeach(beach.id);
    assert.ok(Object.values(result.scores).every(value => value === null));
    assert.equal(result.current.weather.temperature_2m, 24);
    assert.equal(result.current.marine.sea_surface_temperature, null);
    assert.equal(result.dataStatus.marine.status, 'unknown');
    assert.equal(result.safety.estimatedFlag, 'unknown');
    assert.deepEqual(result.forecast.wave, []);
    assert.deepEqual(result.forecast.current, []);
  }
});

test('water classification: reference pagination is bounded, complete and detects duplicates', async t => {
  const cursors = [];
  let duplicate = false;
  t.mock.method(global, 'fetch', async url => {
    const cursor = new URL(url).searchParams.get('startIndex');
    cursors.push(cursor);
    return new Response(JSON.stringify({ type: 'FeatureCollection', totalFeatures: 2, features: [{
      id: duplicate ? 'same' : cursor, properties: { cleabs: 'REF' + cursor, nature: 'Lac', etat_de_l_objet: 'En service' },
      geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[0,1],[0,0]]] },
    }] }));
  });
  assert.equal((await fetchLayer('surface_hydrographique', [0,0,1,1])).collection.features.length, 2);
  assert.deepEqual(cursors, ['0','1']);
  duplicate = true;
  await assert.rejects(fetchLayer('surface_hydrographique', [0,0,1,1]), /Unstable/);
  assert.throws(() => validateReport({ version: 1, sourceUrl: 'https://untrusted.example', classifications: [], catalogueCount: 0 }), /Incomplete/);
});
