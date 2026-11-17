require('reflect-metadata');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const {migrate,manifest}=require('../../scripts/database.cjs');
const {BeachesService}=require('../../dist/modules/beaches/beaches.service');
const {AmenitiesService}=require('../../dist/modules/beaches/amenities.service');
const {ReportsService}=require('../../dist/modules/reports/reports.service');
const {ContributionsService}=require('../../dist/modules/reports/contributions.service');
const {WaterQualityService}=require('../../dist/modules/water-quality/water-quality.service');

test('territory: real borders, preserved history, pagination, direct access and reversible coordinates', {timeout:60000},async t=>{
  const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.pathname,'/littora_ci_test');
  const admin=new Pool({connectionString:url.href});const name='littora_ci_territory_'+randomUUID().replaceAll('-','');
  await admin.query(`create database "${name}" template template0`);url.pathname='/'+name;
  const pool=new Pool({connectionString:url.href});
  t.after(async()=>{await pool.end();try{await admin.query(`drop database "${name}"`);}finally{await admin.end();}});
  await migrate(pool,manifest().slice(0,5));
  const positions=[
    ['Pampelonne',43.2409,6.6635,true],['La Nartelle',43.3308,6.6882,true],
    ['Corse',41.72,9.4,true],['Ouessant',48.459,-5.095,true],
    ['Lac interieur',45.9,6.13,true],['Riviere',44.4,4.4,true],
    ['Hendaye',43.371,-1.775,true],['Menton',43.779,7.51,true],
    ['Brighton',50.8165,-0.123,false],['Bournemouth',50.716,-1.874,false],
    ['Espagne',43.324,-1.971,false],['Italie',43.785,7.56,false],
    ['Monaco',43.7459457,7.433069,false],['Llivia',42.464,1.982,false],
    ['Belgique',51.099,2.583,false],['Allemagne',48.576,7.817,false],
    ['Suisse',46.204,6.143,false],['Guadeloupe',16.25,-61.55,false],['Ocean',0,0,false],
  ].map(([name,lat,lon,included],i)=>({id:`20000000-0000-4000-8000-${String(i).padStart(12,'0')}`,name,lat,lon,included,osmId:'way/'+(900000+i)}));
  for(const b of positions)await pool.query("insert into beaches(id,name,city,lat,lon,osm_id) values($1,$2,'France',$3,$4,$5)",[b.id,b.name,b.lat,b.lon,b.osmId]);
  const foreign=positions.find(b=>b.name==='Monaco');
  await pool.query("insert into reports(beach_id,type,value,status) values($1,'flag','{\"flag\":\"red\"}','verified')",[foreign.id]);
  await pool.query("insert into water_quality(beach_id,status,source,sample_date) values($1,'poor','official-test-source',current_date)",[foreign.id]);
  const snapshot=async()=>{
    const rows={};for(const table of ['beaches','reports','water_quality'])rows[table]=(await pool.query(`select to_jsonb(b) row from ${table} b order by id`)).rows;
    return rows;
  };
  const before=await snapshot();await migrate(pool);assert.deepEqual(await snapshot(),before);assert.deepEqual(await migrate(pool),[]);
  const decisions=(await pool.query('select id,included from beach_territory_review order by id')).rows;
  assert.deepEqual(decisions,positions.map(({id,included})=>({id,included})));
  const amenities=new AmenitiesService(pool),service=new BeachesService(pool,{},amenities);
  const expected=positions.filter(b=>b.included).map(b=>b.id).sort();
  const found=[];let cursor;
  do{const page=await service.catalogue(cursor,3);found.push(...page.beaches.map(b=>b.id));cursor=page.nextCursor;}while(cursor);
  assert.deepEqual(found,expected);
  assert.deepEqual((await service.list(undefined,undefined,500)).map(b=>b.id).sort(),expected);
  assert.ok((await service.list(foreign.lat,foreign.lon,500)).every(b=>expected.includes(b.id)));
  assert.deepEqual((await service.catalogue(undefined,500,'43.74,7.43,43.75,7.44')).beaches,[]);
  const continent={type:'Polygon',coordinates:[[[-6,41],[10,41],[10,52],[-6,52],[-6,41]]]};
  assert.deepEqual((await service.inGeometry(continent)).map(b=>b.id).sort(),expected);
  for(const b of positions){
    if(b.included)assert.equal((await service.get(b.id)).id,b.id);
    else{
      await assert.rejects(service.get(b.id),e=>e.getStatus()===404);
      await assert.rejects(service.nearbyAmenities(b.id),e=>e.getStatus()===404);
    }
  }
  const reports=new ReportsService(pool,{});
  assert.deepEqual(await reports.list(foreign.id),[]);assert.deepEqual(await reports.aggregate(foreign.id),[]);
  assert.equal(await reports.flagConsensus(foreign.id),null);
  assert.equal((await new WaterQualityService(pool).get(foreign.id)).status,'unknown');
  assert.equal(await service.upsertDiscoveredBeach({...foreign,osmId:'way/new-foreign'},'France','Mediterranee'),null);
  assert.equal(await service.upsertDiscoveredBeach({...positions[0],osmId:foreign.osmId},'France','Mediterranee'),null,'Existing hidden OSM identity is never overwritten');
  const originalKey=process.env.REPORT_IP_HASH_KEY;process.env.REPORT_IP_HASH_KEY='territory-isolated-test-key-123456789';
  try{
    const contributions=new ContributionsService(pool);const session=await contributions.session('127.0.0.10');
    await assert.rejects(new ReportsService(pool,contributions).create({beachId:foreign.id,type:'flag',value:{flag:'red'}},
      {token:session.token,address:'127.0.0.10'}),e=>e.getStatus()===404);
  }finally{if(originalKey===undefined)delete process.env.REPORT_IP_HASH_KEY;else process.env.REPORT_IP_HASH_KEY=originalKey;}
  assert.deepEqual(await snapshot(),before,'Filtering and rejected operations preserve every historical row');
  const french=positions[0];
  await pool.query('update beaches set lat=$2,lon=$3 where id=$1',[french.id,foreign.lat,foreign.lon]);
  await assert.rejects(service.get(french.id),e=>e.getStatus()===404,'A stale stored geom cannot bypass the current coordinates');
  await pool.query('update beaches set lat=$2,lon=$3 where id=$1',[french.id,french.lat,french.lon]);
  assert.equal((await service.get(french.id)).id,french.id);
  await pool.query('set enable_seqscan=off');
  const plan=await pool.query('explain select id from catalogue_territory_parts where ST_Covers(geom,ST_SetSRID(ST_MakePoint(6.6635,43.2409),4326))');
  assert.match(JSON.stringify(plan.rows),/catalogue_territory_parts_geom_idx/);
});
