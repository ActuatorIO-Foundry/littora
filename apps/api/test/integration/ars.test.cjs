require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const {migrate}=require('../../scripts/database.cjs');
const {publishArchive,importArs}=require('../../dist/modules/water-quality/ars-import');
const {recordDecision}=require('../../dist/modules/water-quality/official-decisions');
const {WaterQualityService}=require('../../dist/modules/water-quality/water-quality.service');
const {schemaValidator}=require('../../dist/http/contract');
const {scoreFixture}=require('../fixtures.cjs');
const {JobsService}=require('../../dist/jobs/jobs.service');
const {Worker}=require('bullmq');

test('ARS: immutable ingestion, archive vs live closure, explicit lift, worker and unchanged catalogue', {timeout:40000}, async t=>{
  const url=new URL(process.env.TEST_DATABASE_URL),redis=process.env.TEST_REDIS_URL;
  assert.equal(url.pathname,'/littora_ci_test');assert.equal(new URL(redis).pathname,'/15');
  const admin=new Pool({connectionString:url.href}),name='littora_ci_ars_'+randomUUID().replaceAll('-','');
  await admin.query('create database '+name+' template template0');url.pathname='/'+name;
  const pool=new Pool({connectionString:url.href});
  t.after(async()=>{await pool.end();try{await admin.query('drop database '+name);}finally{await admin.end();}});
  await migrate(pool);
  const id=randomUUID(),code='FRL0583009M083026';
  await pool.query("insert into beaches(id,city,name,lat,lon) values($1,'Bandol','Capélan',43.1355,5.7382)",[id]);
  await pool.query(`insert into beach_water_classifications values($1,43.1355,5.7382,'sea','reviewed','https://example.org/test',now(),'fixture','[{}]')`,[id]);
  const site={code,city:'Bandol',name:'Plage du Capelan',insee:'83009',lat:43.1355,lon:5.7382,water:'sea'};
  const obs=(product,identity,data)=>({code,product,identity,observed:'2025-07-10',ended:product==='closure'?'2025-07-12':null,data});
  const measure={value:15,qualifier:'detection-limit'};
  const archive={sites:[site],rejected:[],observations:[obs('sample','2025-07-10',{ecoli:measure,enterococci:measure,sampleStatus:'Pollution'}),
    obs('closure','one',{kind:'Interdiction sanitaire'}),obs('pollution','two',{kind:'Pollution à court terme'})]};
  const before=(await pool.query('select to_jsonb(b) from beaches b')).rows;
  await assert.rejects(publishArchive(pool,{...archive,observations:[...archive.observations,archive.observations[0]]}));
  assert.equal((await pool.query('select count(*)::int n from ars_releases')).rows[0].n,0,'No partial release');
  assert.deepEqual((await Promise.all([publishArchive(pool,archive),publishArchive(pool,archive)])).map(r=>r.imported).sort(),[false,true]);
  const water=new WaterQualityService(pool),read=()=>water.get(id);
  const archived=await read();
  assert.equal(schemaValidator('WaterQuality')({...archived,isDemo:false}),true);
  assert.equal(archived.status,'unknown');assert.equal(archived.restriction.status,'unknown');
  assert.equal(archived.archive.historicalClosures.length,1);assert.equal(archived.archive.historicalPollutions.length,1);
  assert.deepEqual(archived.archive.samples[0].ecoli,measure);
  const source='https://www.bandol.fr/actes/test',event={beachId:id,reference:'test-order',day:'2025-07-11',action:'close',source};
  await assert.rejects(recordDecision(pool,{...event,source:'https://example.org/acte'}));
  await recordDecision(pool,event);await recordDecision(pool,event);
  await pool.query("insert into water_quality(beach_id,status,source,sample_date) values($1,'excellent','fixture-analysis',current_date)",[id]);
  const score=scoreFixture();score.water={get:read};let result=await score.scoreBeach(id);
  assert.equal(result.current.waterQuality.restriction.status,'closed');assert.equal(result.scores.bathing,0);assert.equal(result.scores.family,0);
  assert.equal(result.safety.estimatedFlag,'unknown','A municipal closure does not report a lifeguard flag');
  await recordDecision(pool,{...event,reference:'another'});
  await recordDecision(pool,{...event,action:'lift',day:'2025-07-13'});
  assert.equal((await read()).status,'closed','Lifting one order cannot lift another');
  await recordDecision(pool,{...event,reference:'another',action:'lift',day:'2025-07-14'});
  assert.equal((await read()).status,'unknown');
  assert.deepEqual((await pool.query('select to_jsonb(b) from beaches b')).rows,before);
  await pool.query('update beaches set lon=lon+.01 where id=$1',[id]);assert.equal((await read()).archive,null);

  process.env.ARS_IMPORT_ENABLED='true';process.env.JOBS_REDIS_URL=redis;
  const worker=new Worker('littora-ars',()=>importArs(pool,()=>assert.fail('identical release needs no network')),{connection:{url:redis}});
  try {
    await worker.waitUntilReady();
    const completed=new Promise((resolve,reject)=>{worker.once('completed',(_j,r)=>resolve(r));worker.once('failed',(_j,e)=>reject(e));});
    assert.equal((await new JobsService().enqueueWaterQuality()).queued,true);assert.equal((await completed).imported,false);
  } finally {await worker.close();delete process.env.ARS_IMPORT_ENABLED;delete process.env.JOBS_REDIS_URL;}
});
