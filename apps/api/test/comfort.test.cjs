const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreFixture, beach } = require('./fixtures.cjs');
const { searchConditions, conditionSnapshot } = require('../dist/modules/search/search-conditions');
const { RecommendationsService }=require('../dist/modules/recommendations/recommendations.service');
const { calmProjection }=require('./fixtures.cjs');

test('recommendations exclude unscored and officially closed bathing sites rather than ranking them last',async()=>{
  const sites=['ok','closed','lake','missing'].map(id=>({id,lat:43,lon:6,waterType:id==='lake'?'lake':'sea'}));
  const svc=new RecommendationsService({list:async()=>sites,closedForBathing:async()=>new Set(['closed'])},
    {getManyJson:async()=>[calmProjection(),calmProjection(),null,null]}, {activeCommunity:async()=>({byBeach:new Map()})});
  const rows=await svc.best(43,6,'family');
  assert.deepEqual(rows.map(r=>r.id),['ok']);
  assert.equal(rows[0].scoreExplanation.score,rows[0].selectedScore);
});

test('comfort: the same six observations and deductions explain the result in list and detail', async () => {
  const r = await scoreFixture().scoreBeach(beach.id);
  const e = r.explanations.bathing;
  assert.equal(e.version, 'confort-3');
  assert.equal(e.status, 'calculated');
  assert.equal(e.required, 6);
  assert.equal(e.available, 6);
  assert.equal(e.score, Math.max(0, 100 + e.factors.reduce((sum, f) => sum + f.points, 0)));
  assert.equal(e.score, r.scores.bathing);
  assert.deepEqual(searchConditions(beach, conditionSnapshot(r), Date.now()).explanations, r.explanations);
});
test('comfort: reference scenarios pin all four profiles and do not reward unverified facilities', async () => {
  const s = scoreFixture({ quality: 'unknown' });
  const temperate = { bathing: 77, family: 72, paddle: 63, boat: 77 };
  assert.deepEqual((await s.scoreBeach(beach.id)).scores, temperate);
  s.beaches = {
    get: async () => ({ ...beach, has_lifeguard: null, has_toilets: false, has_parking: false }),
  };
  assert.deepEqual((await s.scoreBeach(beach.id)).scores, temperate);
  const rough = await scoreFixture({
    marine: { current: { sea_surface_temperature: 22, wave_height: 4, ocean_current_velocity: 1 } },
  }).scoreBeach(beach.id);
  assert.deepEqual(rough.scores, { bathing: 0, family: 0, paddle: 0, boat: 0 });
  const pollution = await scoreFixture({
    quality: 'poor',
    reports: [{ type: 'pollution', count: 2, confidence: 1 }],
  }).scoreBeach(beach.id);
  assert.deepEqual(pollution.scores, { ...temperate, bathing: 20, family: 15 });
});
test('comfort: unavailable units or missing time withhold the relevant profiles, not real zero', async () => {
  const r = await scoreFixture({
    marine: {
      units: { wave_height: 'm', ocean_current_velocity: 'm/s' },
      current: { wave_height: 0, ocean_current_velocity: 0, sea_surface_temperature: 22 },
    },
  }).scoreBeach(beach.id);
  assert.equal(r.explanations.bathing.score, null);
  assert.deepEqual(r.explanations.bathing.invalid, ['Température de l’eau']);
  assert.deepEqual(r.explanations.bathing.missing, []);
  assert.equal(r.explanations.bathing.available, 5);
  assert.equal(r.explanations.paddle.status, 'calculated');
  const expired = await scoreFixture({ weather: { validAt: null } }).scoreBeach(beach.id);
  assert.equal(expired.explanations.boat.score, null);
  assert.deepEqual(expired.explanations.boat.invalid,['Vent','Rafales']);
});

test('comfort: stale visible wind and UV are distinguished from absent gusts; only fresh sea contributes', async () => {
  const r = await scoreFixture({weather:{status:'stale',current:{wind_speed_10m:32.9,uv_index:0.1}},
    marine:{current:{wave_height:4.4,sea_surface_temperature:13,ocean_current_velocity:0}}}).scoreBeach(beach.id);
  const e=r.explanations.bathing;
  assert.equal(e.status,'partial');assert.equal(e.available,3);assert.equal(e.required,6);
  assert.equal(e.partialScore,0);assert.equal(e.score,null);
  assert.deepEqual(e.stale,['Vent','Indice UV']);assert.deepEqual(e.missing,['Rafales']);
  assert.deepEqual(e.factors.map(f=>f.label),['Vagues','Courant marin','Température de l’eau']);
  assert.deepEqual(searchConditions(beach,conditionSnapshot(r),Date.now()).explanations,r.explanations);
  assert.equal(r.safety.estimatedFlag,'unknown');
});

test('comfort: a single real zero gives a labelled upper bound, not a favorable recommendation',async()=>{
  const s=calmProjection();s.weather={uv_index:0};s.marine={};
  const b={id:'partial',lat:s.lat,lon:s.lon,waterType:'sea'};
  const r=searchConditions(b,s,Date.now());
  assert.equal(r.explanations.bathing.partialScore,100);assert.equal(r.explanations.bathing.available,1);
  assert.equal(r.explanations.bathing.score,null);assert.equal(r.estimatedFlag,'unknown');
  assert.equal(r.explanations.boat.status,'insufficient');assert.equal(r.explanations.boat.partialScore,null);
  const svc=new RecommendationsService({list:async()=>[b],closedForBathing:async()=>new Set()},
    {getManyJson:async()=>[s]}, {activeCommunity:async()=>({byBeach:new Map()})});
  assert.deepEqual(await svc.best(43,6,'bathing'),[]);
  assert.equal(searchConditions(b,s,Date.now(),true).explanations.bathing.partialScore,null);
});
test('comfort: freshwater never receives a marine score; an official closure is independent of coverage', async () => {
  const s = scoreFixture({ quality: 'closed' });
  s.beaches = { get: async () => ({ ...beach, waterType: 'river' }) };
  const r = await s.scoreBeach(beach.id);
  assert.equal(r.explanations.bathing.status, 'closed');
  assert.equal(r.scores.bathing, 0);
  assert.equal(r.explanations.paddle.status, 'not-applicable');
  assert.deepEqual(r.explanations.paddle.factors, []);
  const reopened = searchConditions(r.beach, conditionSnapshot(r), Date.now(), false);
  assert.equal(reopened.scores.bathing, null);
  assert.equal(reopened.explanations.bathing.status, 'not-applicable');
});
