require('reflect-metadata');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomUUID}=require('node:crypto');
const {once}=require('node:events');
const {Pool}=require('pg');
const {migrate}=require('../../scripts/database.cjs');
const {review}=require('../../scripts/classify-water.cjs');
const {SearchService}=require('../../dist/modules/search/search.service');
const {CacheService}=require('../../dist/cache/cache.service');
const {BeachesService}=require('../../dist/modules/beaches/beaches.service');
const {AmenitiesService}=require('../../dist/modules/beaches/amenities.service');
const {ReportsService}=require('../../dist/modules/reports/reports.service');
const {conditionKey}=require('../../dist/modules/search/search-conditions');
const {present}=require('../../dist/http/presenters');
const {schemaValidator}=require('../../dist/http/contract');

test('search: complete PostGIS scope, amenities, fresh conditions, stable Redis pages and unchanged catalogue',async t=>{
  const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.pathname,'/littora_ci_test');
  assert.equal(new URL(process.env.TEST_REDIS_URL).pathname,'/15');
  const admin=new Pool({connectionString:url.href}),name='littora_ci_search_'+randomUUID().replaceAll('-','');
  await admin.query(`create database "${name}" template template0`);url.pathname='/'+name;
  const pool=new Pool({connectionString:url.href});const old=process.env.REDIS_URL;
  process.env.REDIS_URL=process.env.TEST_REDIS_URL;const cache=new CacheService();
  if(old===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=old;
  const keys=[];const set=cache.setJson.bind(cache);cache.setJson=async(k,v,ttl)=>{keys.push(k);return set(k,v,ttl);};
  t.after(async()=>{if(keys.length)await cache.redis.del(...keys);await cache.onModuleDestroy();
    await pool.end();try{await admin.query(`drop database "${name}"`);}finally{await admin.end();}});
  if(cache.redis.status!=='ready')await once(cache.redis,'ready');
  await migrate(pool);
  const id=n=>`19000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  await pool.query(`insert into beaches(id,name,lat,lon,geom)
    select ('19000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Same name',43,6,
    ST_SetSRID(ST_MakePoint(6,43),4326)::geography from generate_series(1,602)n`);
  await pool.query(`insert into beaches(id,name,lat,lon,geom) values
    ($1,'Outside triangle',43.9,6.9,ST_SetSRID(ST_MakePoint(6.9,43.9),4326)::geography),
    ($2,'Monaco',43.739,7.427,ST_SetSRID(ST_MakePoint(7.427,43.739),4326)::geography)`,[id(603),id(604)]);
  await pool.query('update beaches set geom=null where id=$1',[id(602)]);
  for(const [n,type]of [[600,'sea'],[601,'lake'],[602,'river']])await review(pool,id(n),type,'https://example.org/test-reference','Isolated search fixture');
  const amenities=new AmenitiesService(pool),beaches=new BeachesService(pool,cache,amenities),reports=new ReportsService(pool,{});
  const target=await beaches.get(id(600));
  await amenities.persist(target,[{id:'node/1',name:'Parking',category:'parking',lat:43,lon:6},
    {id:'node/2',name:'Toilets',category:'toilets',lat:43,lon:6},{id:'node/3',name:'Rescue',category:'rescue',lat:43,lon:6}],
    'https://overpass-api.de/api/interpreter');
  const before=(await pool.query('select to_jsonb(b) row from beaches b order by id')).rows;
  const now=new Date().toISOString();const source={provider:'open-meteo',kind:'forecast',status:'available',fetchedAt:now,validAt:now,units:{}};
  await cache.setJson(conditionKey(target.id),{lat:43,lon:6,waterType:'sea',calculatedAt:now,waterTemp:21,airTemp:0,
    scores:{bathing:70,family:80,paddle:30,boat:10},dataStatus:{weather:source,marine:source}},900);
  const commune={code:'83009',name:'Test',department:{code:'83',name:'Var'},region:{code:'93',name:'Provence'},
    center:{lat:43,lon:6},bbox:[42.9,5.9,44,7],contour:{type:'Polygon',coordinates:[[[5.9,42.9],[7,42.9],[5.9,44],[5.9,42.9]]]}};
  const service=new SearchService(beaches,{get:async()=>commune},reports,cache);
  const originalFetch=global.fetch;global.fetch=()=>{throw Error('Search must not call providers');};t.after(()=>global.fetch=originalFetch);
  const result=await service.search({minWaterTemp:21,maxWaterTemp:21,usage:'family',minScore:80});
  assert.equal(result.total,1);assert.equal(result.items[0].id,target.id);
  const validate=schemaValidator('SearchPage');assert.equal(validate(present('searchBeaches',result,{})),true,JSON.stringify(validate.errors));
  const combined=await service.search({communeCode:'83009',waterType:'sea',parking:true,toilets:true,rescueStation:true,minWaterTemp:21});
  assert.equal(combined.total,1);assert.equal(combined.items[0].has_lifeguard,null);
  assert.equal((await service.search({bbox:'42.9,5.9,43.1,6.1',waterType:'river'})).items[0].id,id(602),'Null legacy geometry still respects actual coordinates');
  assert.equal((await service.search({waterType:'lake'})).total,1);
  assert.equal((await service.search({communeCode:'83009'})).total,602,'Bounding rectangle must not replace the actual commune');
  assert.equal((await service.search({lat:43,lon:6,radiusKm:1})).total,602);
  assert.equal((await service.search({bbox:'48,2,49,3'})).total,0);
  assert.equal((await service.search({bbox:'-90,-180,90,180'})).total,603,'Global bounds must not collapse into a spherical polygon');
  assert.equal((await service.search({q:"' OR true --"})).total,0,'Search text is a literal SQL parameter');
  assert.equal((await service.search({flag:'green'})).total,0,'A calculated score cannot invent a flag');
  for(let n=1;n<=4;n++) {
    const actor=randomUUID(),report=randomUUID();
    await pool.query("insert into report_contributors(id,token_hash) values($1,$2)",[actor,String(n).repeat(64)]);
    await pool.query("insert into reports(id,beach_id,type,value,status,created_at) values($1,$2,'flag',$3,'verified',now()-interval '30 minutes')",
      [report,target.id,{flag:n===4?'red':'green'}]);
    await pool.query("insert into report_contributions(report_id,contributor_id,network_hash,observed_at,expires_at) values($1,$2,$3,now()-interval '30 minutes',now()+interval '2 hours')",
      [report,actor,String(n).repeat(64)]);
  }
  assert.deepEqual((await reports.flagConsensuses([target.id])).get(target.id),await reports.flagConsensus(target.id));
  const green=await service.search({flag:'green'});assert.equal(green.total,1);assert.equal(green.items[0].flagSource,'community');
  assert.ok(green.items[0].recentRedAt,'A green search result must retain the recent red warning');
  await pool.query("update reports set status='pending' where value->>'flag'='green'");
  assert.equal((await service.search({flag:'green'})).total,0,'Moderation changes are reflected by a new search');
  const seen=[];let cursor;do{const page=await service.search({limit:200,...(cursor?{cursor}:{})});
    seen.push(...page.items.map(b=>b.id));cursor=page.pageInfo.nextCursor;}while(cursor);
  assert.equal(seen.length,603);assert.equal(new Set(seen).size,603);assert.ok(!seen.includes(id(604)));
  const measured=[];const query=pool.query.bind(pool);
  pool.query=async(sql,params)=>{if(sql.includes('from beach_catalogue')&&sql.includes('distanceKm')){
    const plan=await query('explain (analyze,format json) '+sql,params);measured.push(plan.rows[0]['QUERY PLAN'][0]);}return query(sql,params);};
  await service.search({lat:43,lon:6,radiusKm:50});
  pool.query=query;
  assert.ok(measured[0]['Execution Time']<5000,'Bounded fixture search should finish within five seconds');
  await pool.query('set enable_seqscan=off');
  const plan=await pool.query('explain select id from beaches where ST_DWithin(geom,ST_SetSRID(ST_MakePoint(6,43),4326)::geography,50000)');
  assert.match(JSON.stringify(plan.rows),/beaches_geom_idx/);
  assert.deepEqual((await pool.query('select to_jsonb(b) row from beaches b order by id')).rows,before);
});
