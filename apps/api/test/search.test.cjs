require('reflect-metadata');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {SearchService} = require('../dist/modules/search/search.service');
const {validateSearch} = require('../dist/modules/search/search-input');
const {conditionKey,searchConditions} = require('../dist/modules/search/search-conditions');
const {scoreFixture} = require('./fixtures.cjs');

const rows = Array.from({length:65},(_,i)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,
  name:'Same name',lat:43,lon:6,waterType:'sea',distanceKm:i}));
const snapshot=require('./fixtures.cjs').calmProjection;
function fixture() {
  const stored=new Map();let reads=0;
  const cache={getJson:async k=>structuredClone(stored.get(k)??null),
    getManyJson:async keys=>keys.map(k=>stored.get(k)??null),
    setJson:async(k,v)=>{stored.set(k,structuredClone(v));return true;}};
  const community={key:'initial',byBeach:new Map()};
  const service=new SearchService({closedForBathing:async()=>new Set(),searchCandidates:async()=>{reads++;return rows;}},
    {get:async()=>{throw Error('Unexpected geographic request');}},
    {flagConsensuses:async()=>new Map(),activeCommunity:async()=>community},cache);
  return {service,cache,stored,community,reads:()=>reads};
}
test('search: retired reports stop penalising immediately, including with a warm forecast cache',async()=>{
  const {service,stored,community}=fixture(), id=rows[0].id;
  const pollution=[{type:'pollution',count:1,confidence:1}];
  stored.set(conditionKey(id),{...snapshot(),community:pollution});
  community.byBeach.set(id,pollution);
  const old=await service.search({limit:1});
  community.key='withdrawn';community.byBeach.clear();
  await assert.rejects(service.search({limit:1,cursor:old.pageInfo.nextCursor}),e=>e.getStatus()===409);
  const fresh=await service.search({limit:1});
  assert.equal(fresh.items[0].scores.bathing-old.items[0].scores.bathing,22);
});
test('search: dynamic criteria apply beyond candidate 30, including real zero and inclusive bounds',async()=>{
  const {service,stored}=fixture();stored.set(conditionKey(rows[64].id),snapshot(0));
  const result=await service.search({minWaterTemp:0,maxWaterTemp:0,minAirTemp:0,maxAirTemp:0,usage:'family',minScore:20});
  assert.deepEqual(result.items.map(b=>b.id),[rows[64].id]);assert.equal(result.total,1);
  assert.equal(result.items[0].selectedScore,20);assert.equal(result.coverage.waterTemperature,1);
  assert.equal(result.items[0].scoreExplanation.score,20);assert.equal((await service.search({usage:'family',minScore:21})).total,0);
  assert.equal((await service.search({minWaterTemp:1})).total,0);
});
test('search: frozen stable pagination survives changes without duplicate names or IDs',async()=>{
  const {service,stored,reads}=fixture();const input={sort:'score',limit:17};
  stored.set(conditionKey(rows[64].id),snapshot());
  let page=await service.search(input);const seen=[...page.items.map(b=>b.id)];
  stored.set(conditionKey(rows[0].id),snapshot());
  while(page.pageInfo.nextCursor){page=await service.search({...input,cursor:page.pageInfo.nextCursor});seen.push(...page.items.map(b=>b.id));}
  assert.equal(seen.length,65);assert.equal(new Set(seen).size,65);assert.equal(seen[0],rows[64].id);assert.equal(reads(),1);
});
test('search: foreign, malformed and expired cursors never silently restart or change filters',async()=>{
  const {service,stored}=fixture();const result=await service.search({limit:2});const cursor=result.pageInfo.nextCursor;
  await assert.rejects(service.search({limit:2,q:'changed',cursor}),e=>e.getStatus()===400);
  await assert.rejects(service.search({cursor:'bad'}),e=>e.getStatus()===400);
  for(const [key,value] of stored)if(key.startsWith('search:page:'))value.expiresAt='2000-01-01T00:00:00Z';
  await assert.rejects(service.search({limit:2,cursor}),e=>e.getStatus()===409);
});
test('search: stale, missing, future and moved conditions cannot satisfy numeric filters',()=>{
  for(const modify of [s=>s.dataStatus.marine.status='stale',s=>s.dataStatus.marine.fetchedAt='2000-01-01T00:00:00Z',
    s=>s.dataStatus.marine.validAt='2099-01-01T00:00:00Z',s=>s.lat=44,s=>s.waterType='lake']) {
    const s=snapshot();modify(s);const result=searchConditions(rows[0],s,Date.now());
    assert.equal(result.waterTemp,null);assert.equal(result.scores.bathing,null);
  }
  assert.equal(searchConditions(rows[0],null,Date.now()).airTemp,null);
});
test('search: invalid combinations, radius and min/max are rejected before SQL',()=>{
  for(const input of [{lat:43},{lat:91,lon:6,radiusKm:10},{lat:43,lon:6,radiusKm:0},
    {lat:43,lon:6,radiusKm:201},{bbox:'44,6,43,7'},{bbox:'43,5,44,6',communeCode:'83009'},
    {minWaterTemp:25,maxWaterTemp:20},{minAirTemp:0,maxAirTemp:-5},{limit:201},{sort:'distance'}]) {
    assert.throws(()=>validateSearch(input),e=>e.getStatus()===400);
  }
});
test('search: cache outage returns explicit unavailability instead of incomplete pagination',async()=>{
  const {service,cache}=fixture();cache.setJson=async()=>false;
  await assert.rejects(service.search({limit:20}),e=>e.getStatus()===503);
  assert.equal((await service.search({})).total,65);
});
test('search: score publication retains source times, nulls and never the calculated flag',async()=>{
  const service=scoreFixture();let saved;
  service.cache={setJson:async(key,value,ttl)=>{saved={key,value,ttl};return true;}};
  await service.scoreBeach(rows[0].id);
  assert.equal(saved.key,conditionKey(rows[0].id));assert.equal(saved.ttl,900);
  assert.equal(saved.value.marine.sea_surface_temperature,22);assert.equal(saved.value.flag,undefined);
  saved.value.dataStatus.marine.fetchedAt=null;
  assert.equal(searchConditions(saved.value,saved.value,Date.now()).waterTemp,null,'Undated providers are not searchable forecasts');
});

test('search: a new official closure overrides cached scores and expires outstanding cursors',async()=>{
  const {service,stored}=fixture();
  stored.set(conditionKey(rows[0].id),snapshot());
  const page=await service.search({limit:2});
  service.beaches.closedForBathing=async()=>new Set([rows[0].id]);
  await assert.rejects(service.search({limit:2,cursor:page.pageInfo.nextCursor}),e=>e.getStatus()===409);
  assert.equal((await service.search({minScore:65,usage:'family'})).total,0);
  assert.equal((await service.search({})).items.find(b=>b.id===rows[0].id).bathingRestriction,'closed');
  assert.equal((await service.search({minScore:20,usage:'paddle'})).total,1);
});
