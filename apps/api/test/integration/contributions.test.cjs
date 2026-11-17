require('reflect-metadata');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('pg');
const {Test}=require('@nestjs/testing');
const {migrate,seed}=require('../../scripts/database.cjs');
const {PG}=require('../../dist/database/database.module');
const {ReportsService}=require('../../dist/modules/reports/reports.service');
const {ReportsController}=require('../../dist/modules/reports/reports.controller');
const {ContributionsService}=require('../../dist/modules/reports/contributions.service');
const {configureHttpBoundary}=require('../../dist/http/http-boundary');

test('contributions: real HTTP validation, shared quotas, concurrency, privacy and expiry', {timeout:30000},async t=>{
  const url=new URL(process.env.TEST_DATABASE_URL);
  assert.equal(url.pathname,'/littora_ci_test');
  const admin=new Pool({connectionString:url.href,max:1});
  const name='littora_ci_'+randomUUID().replaceAll('-','');
  await admin.query(`create database "${name}" template template0`);
  url.pathname='/'+name;
  const pool=new Pool({connectionString:url.href});
  let app;
  const previousKey=process.env.REPORT_IP_HASH_KEY;
  process.env.REPORT_IP_HASH_KEY=randomBytes(32).toString('hex');
  t.after(async()=>{
    if(previousKey===undefined)delete process.env.REPORT_IP_HASH_KEY;else process.env.REPORT_IP_HASH_KEY=previousKey;
    await app?.close();await pool.end();
    try{await admin.query(`drop database "${name}"`);}finally{await admin.end();}
  });
  await migrate(pool);await seed(pool);
  const beach=(await pool.query('select id from beaches order by id limit 1')).rows[0].id;
  const module=await Test.createTestingModule({controllers:[ReportsController],providers:[ReportsService,ContributionsService,{provide:PG,useValue:pool}]}).compile();
  app=module.createNestApplication({logger:false});app.setGlobalPrefix('api');configureHttpBoundary(app);
  await app.listen(0,'127.0.0.1');const origin=await app.getUrl();
  const request=(path,body,token,extra={})=>fetch(origin+'/api/'+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...extra},body:JSON.stringify(body)});
  const payload={beachId:beach,type:'flag',value:{flag:'red',source:'official'},confidence:1};
  assert.equal((await request('reports',payload)).status,401);
  assert.equal((await request('reports',payload,'a'.repeat(64))).status,401);
  const sessionResponse=await request('reports/session',{});
  assert.equal(sessionResponse.status,201);assert.equal(sessionResponse.headers.get('cache-control'),'no-store');
  const session=await sessionResponse.json();assert.match(session.token,/^[a-f0-9]{64}$/);
  for(const body of [{...payload,beachId:'bad'},{...payload,type:'unsafe'},{...payload,observedAt:'2099-01-01T00:00:00Z'},
    {...payload,value:{flag:'red',note:'x'.repeat(2001)}},{...payload,status:'verified'},{...payload,value:{flag:'green',drapeau:'rouge'}}]){
    assert.equal((await request('reports',body,session.token)).status,400);
  }
  assert.equal((await request('reports',{...payload,beachId:randomUUID()},session.token)).status,404);
  const response=await request('reports',payload,session.token);assert.equal(response.status,201);
  const report=await response.json();assert.equal(report.confidence,0);assert.equal(report.status,'pending');assert.deepEqual(report.value,{flag:'red'});
  assert.ok(!JSON.stringify(report).includes(session.token));assert.ok(!('network_hash' in report));
  assert.equal((await request('reports',payload,session.token)).status,409);
  const second=await (await request('reports/session',{})).json();
  assert.equal((await request('reports',payload,second.token,{'x-forwarded-for':'198.51.100.4'})).status,409,'Resetting a token or spoofing forwarded headers does not bypass network duplicates');
  assert.deepEqual(await (await fetch(origin+'/api/reports?beachId='+beach)).json(),[]);
  const service=app.get(ReportsService);
  assert.deepEqual(await service.aggregate(beach),[]);assert.equal(await service.flagConsensus(beach),null);
  const results=await Promise.all(Array.from({length:6},()=>request('reports',{beachId:beach,type:'jellyfish'},session.token)));
  assert.equal(results.filter(r=>r.status===201).length,1);
  assert.equal(results.filter(r=>r.status===409).length,5);
  assert.equal((await request('reports',{beachId:beach,type:'pollution'},session.token)).status,201);
  assert.equal((await request('reports',{beachId:beach,type:'crowd'},session.token)).status,429);
  assert.equal((await request('reports/session',{})).status,201);
  assert.equal((await request('reports/session',{})).status,429);
  await pool.query("update reports set status='verified',confidence=.5 where id=$1",[report.id]);
  assert.equal((await service.list(beach)).length,1);assert.equal((await service.aggregate(beach))[0].count,1);
  const additional=[];
  try{
    for(let i=0;i<5;i++){
      const actor=(await pool.query('insert into report_contributors(token_hash) values($1) returning id',[randomBytes(32).toString('hex')])).rows[0].id;
      const row=(await pool.query("insert into reports(beach_id,type,value,status) values($1,'flag','{\"flag\":\"green\"}','verified') returning id",[beach])).rows[0].id;
      additional.push(row);
      await pool.query("insert into report_contributions(report_id,contributor_id,network_hash,observed_at,expires_at) values($1,$2,$3,now()-interval '5 minutes',now()+interval '23 hours')",[row,actor,'distinct-network-'+i]);
    }
    const consensus=await service.flagConsensus(beach);
    assert.equal(consensus.flag,'green');assert.equal(consensus.participants,6);
    assert.equal(consensus.counts.red,1);assert.ok(consensus.recentRedAt);
    assert.ok(consensus.history.some(r=>r.flag==='red'));
  }finally{await pool.query('delete from reports where id=any($1::uuid[])',[additional]);}
  await pool.query("update report_contributions set observed_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' where report_id=$1",[report.id]);
  assert.deepEqual(await service.list(beach),[]);assert.deepEqual(await service.aggregate(beach),[]);
  await pool.query("update report_contributors set expires_at=now()-interval '1 minute'");
  assert.equal((await request('reports',{beachId:beach,type:'current'},session.token)).status,401);
  await app.get(ContributionsService).purgeExpired();
  assert.equal((await pool.query('select count(*)::int n from report_contributors')).rows[0].n,0);
  assert.equal((await pool.query('select network_hash from report_contributions where report_id=$1',[report.id])).rows[0].network_hash,null);
  const serialized=JSON.stringify((await pool.query('select * from report_contributions')).rows);
  assert.ok(!serialized.includes('127.0.0.1'));assert.ok(!serialized.includes(session.token));
  assert.equal((await pool.query('select count(*)::int n from reports')).rows[0].n,3,'Only three distinct submissions persisted');
});
