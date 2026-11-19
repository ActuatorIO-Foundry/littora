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
  const role='moderator_'+randomUUID().replaceAll('-','');
  let app, operator, roleCreated=false;
  const previousKey=process.env.REPORT_IP_HASH_KEY;
  process.env.REPORT_IP_HASH_KEY=randomBytes(32).toString('hex');
  t.after(async()=>{
    if(previousKey===undefined)delete process.env.REPORT_IP_HASH_KEY;else process.env.REPORT_IP_HASH_KEY=previousKey;
    operator?.release(true);await app?.close();await pool.end();
    try{await admin.query(`drop database "${name}"`);if(roleCreated)await admin.query(`drop role "${role}"`);}finally{await admin.end();}
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
  const contestSession=await request('reports/session',{});
  assert.equal(contestSession.status,201);
  const reviewer=(await contestSession.json()).token;
  assert.equal((await request('reports/session',{})).status,429);
  await admin.query(`create role "${role}" nologin`);roleCreated=true;
  operator=await pool.connect();
  await operator.query(`set session authorization "${role}"`);
  const decide=(id,action,reason)=>operator.query('select moderation.decide($1,$2,$3)',[id,action,reason]);
  await assert.rejects(decide(report.id,'publish','consistent'),{code:'42501'});
  await pool.query(`grant usage on schema moderation to "${role}"`);
  await pool.query(`grant select on moderation.queue,moderation.decisions to "${role}"`);
  await pool.query(`grant execute on function moderation.decide(uuid,text,text) to "${role}"`);
  const queue=(await operator.query('select * from moderation.queue')).rows;
  assert.equal(queue.length,3);assert.ok(!JSON.stringify(queue).includes('network_hash'));
  await assert.rejects(operator.query("update public.reports set status='verified' where id=$1",[report.id]),{code:'42501'});
  await assert.rejects(operator.query('delete from moderation.decisions'),{code:'42501'});
  const dispute=id=>request('reports',{beachId:beach,type:'other',value:{contests:id}},reviewer);
  assert.equal((await dispute(report.id)).status,404,'Pending reports cannot be contested or enumerated');
  await decide(report.id,'publish','consistent');
  await assert.rejects(decide(report.id,'publish','consistent'),{code:'55000'});
  const feed=()=>fetch(origin+'/api/reports?beachId='+beach).then(r=>r.json());
  const [published]=await feed();
  const publicState=await service.activeCommunity([beach]);
  assert.equal(publicState.byBeach.get(beach)[0].count,1);
  assert.equal(published.id,report.id);assert.equal(published.provenance.verified,true);
  assert.ok(!JSON.stringify(published).includes(role));assert.ok(published.expires_at);
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
  const dismissed=await dispute(report.id);assert.equal(dismissed.status,201);
  const dismissedId=(await dismissed.json()).id;
  await decide(dismissedId,'dismiss','unverifiable');
  assert.deepEqual((await feed()).map(r=>r.id),[report.id]);
  // Advance only the fixture's duplicate window, not the provider or audit clock.
  await pool.query("update reports set created_at=now()-interval '16 minutes' where id=$1",[dismissedId]);
  const queued=await dispute(report.id);assert.equal(queued.status,201);
  const caseId=(await queued.json()).id;
  assert.deepEqual((await feed()).map(r=>r.id),[report.id]);
  await assert.rejects(decide(caseId,'publish','consistent'),{code:'55000'});
  await decide(caseId,'uphold','incorrect');
  assert.equal(await service.flagConsensus(beach),null);assert.equal((await service.flagConsensuses([beach])).size,0);
  assert.deepEqual(await feed(),[]);assert.deepEqual(await service.aggregate(beach),[]);
  assert.notEqual((await service.activeCommunity([beach])).key,publicState.key);
  assert.deepEqual((await operator.query('select action,operator_login,dispute_id from moderation.decisions order by id')).rows,
    [{action:'publish',operator_login:role,dispute_id:null},{action:'dismiss',operator_login:role,dispute_id:null},{action:'withdraw',operator_login:role,dispute_id:caseId},
      {action:'uphold',operator_login:role,dispute_id:null}]);
  await assert.rejects(decide(report.id,'publish','consistent'),{code:'55000'});
  const pending=queue.find(r=>r.type==='pollution').id;
  const concurrent=await pool.connect();
  try {
    await concurrent.query(`set session authorization "${role}"`);
    const attempts=await Promise.allSettled([decide(pending,'reject','unverifiable'),
      concurrent.query("select moderation.decide($1,'reject','duplicate')",[pending])]);
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(attempts.find(r=>r.status==='rejected').reason.code,'55000');
  } finally {concurrent.release(true);}
  const remaining=queue.find(r=>r.type==='jellyfish').id;
  await decide(remaining,'publish','consistent');
  assert.deepEqual((await feed()).map(r=>r.id),[remaining]);
  await pool.query("update report_contributions set observed_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' where report_id=$1",[remaining]);
  await assert.rejects(decide(remaining,'publish','consistent'),{code:'P0002'});
  assert.deepEqual(await service.list(beach),[]);assert.deepEqual(await service.aggregate(beach),[]);
  await pool.query(`revoke execute on function moderation.decide(uuid,text,text) from "${role}"`);
  await assert.rejects(decide(report.id,'withdraw','incorrect'),{code:'42501'});
  await pool.query("update report_contributors set expires_at=now()-interval '1 minute'");
  assert.equal((await request('reports',{beachId:beach,type:'current'},session.token)).status,401);
  await app.get(ContributionsService).purgeExpired();
  assert.equal((await pool.query('select count(*)::int n from report_contributors')).rows[0].n,0);
  assert.equal((await pool.query('select network_hash from report_contributions where report_id=$1',[remaining])).rows[0].network_hash,null);
  const serialized=JSON.stringify((await pool.query('select * from report_contributions')).rows);
  assert.ok(!serialized.includes('127.0.0.1'));assert.ok(!serialized.includes(session.token));
  assert.equal((await pool.query('select count(*)::int n from reports')).rows[0].n,5,'Three observations and two private disputes persisted');
});
