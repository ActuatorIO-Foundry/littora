require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const Redis=require('ioredis');
const {migrate}=require('../../scripts/database.cjs');
const {review}=require('../../scripts/classify-water.cjs');
const {ScoreService}=require('../../dist/modules/score/score.service');
const {SearchService}=require('../../dist/modules/search/search.service');
const {BeachesService}=require('../../dist/modules/beaches/beaches.service');
const {ReportsService}=require('../../dist/modules/reports/reports.service');
const {conditionKey}=require('../../dist/modules/search/search-conditions');
const {ForecastStore}=require('../../dist/shared/forecast-store');
const {collectOne,projectDue}=require('../../dist/jobs/forecast-collector');
const {measure,recordCoverage,history}=require('../../dist/jobs/score-coverage');
const {calmProjection}=require('../fixtures.cjs');

test('new collection restores a recent search projection without a visit; list, detail and monitor agree',async t=>{
  const url=new URL(process.env.TEST_DATABASE_URL);
  assert.equal(url.pathname,'/littora_ci_test');assert.equal(new URL(process.env.TEST_REDIS_URL).pathname,'/15');
  const admin=new Pool({connectionString:url.href}),name='littora_ci_score_'+randomUUID().replaceAll('-','');
  await admin.query('create database "'+name+'" template template0');url.pathname='/'+name;
  const db=new Pool({connectionString:url.href}),redis=new Redis(process.env.TEST_REDIS_URL,{keyPrefix:name+':'});
  const id=randomUUID(),written=new Set();
  t.after(async()=>{if(written.size)await redis.del(...written);await redis.quit();await db.end();
    try{await admin.query('drop database "'+name+'"');}finally{await admin.end();}});
  await migrate(db);
  await db.query("insert into beaches (id,name,lat,lon) values ($1,'Test',43,6)",[id]);
  await review(db,id,'sea','https://example.org/reference','Isolated test');
  const cache={setJson:async(k,v,ttl)=>{written.add(k);return !!await redis.set(k,JSON.stringify(v),'EX',ttl);},
    getManyJson:async keys=>(await redis.mget(...keys)).map(s=>s?JSON.parse(s):null)};
  const beaches=new BeachesService(db,cache,{}),reports=new ReportsService(db,{}),store=new ForecastStore(db);
  const search=new SearchService(beaches,{},reports,cache);
  const source=name=>({get:(lat,lon)=>store.get(name,lat,lon)});
  const detail=new ScoreService(beaches,source('open-meteo'),source('open-meteo-marine'),
    {get:async()=>({})},{get:async()=>({status:'unknown'})},reports,cache);
  const p=calmProjection();
  const request=async input=>{
    const marine=new URL(input).hostname.startsWith('marine-'),g=marine?'marine':'weather';
    return Response.json({hourly_units:p.dataStatus[g].units,hourly:{time:[Math.floor(Date.now()/1000)],
      ...Object.fromEntries(Object.entries(p[g]).map(([k,v])=>[k,[v]]))}});
  };
  const release=()=>db.query('update forecast_dispatch set next_request_at=now()');
  await collectOne(db,request);await release();await collectOne(db,request);
  await db.query("update forecast_zones set last_success_at=now()-interval '7 hours',next_check_at=now()");
  await projectDue(db,detail);
  const item=async()=>(await search.search({})).items[0];
  assert.equal((await item()).scoreExplanation.status,'insufficient');
  assert.equal((await measure(db,redis)).byUsage.bathing.reasons.stale,1);
  await release();await collectOne(db,request);
  assert.equal((await measure(db,redis)).awaitingProjection,1);
  assert.equal((await projectDue(db,detail)).projected,1);
  assert.equal((await item()).scoreExplanation.status,'partial');
  await release();await collectOne(db,request);
  assert.equal((await projectDue(db,detail)).projected,1);
  const fresh=await item();assert.equal(fresh.scoreExplanation.status,'calculated');
  assert.equal(fresh.selectedScore,(await detail.scoreBeach(id)).scores.bathing);
  assert.equal((await projectDue(db,detail)).projected,0);
  const originalSet=redis.set.bind(redis);redis.set=(key,...args)=>{written.add(key);return originalSet(key,...args);};
  const recorded=await recordCoverage(db,redis);
  assert.equal((await history(redis,1,Date.parse(recorded.asOf)))[0].sample.byUsage.bathing.calculated,1);
  assert.equal(await redis.exists(conditionKey(id)),1);
});
