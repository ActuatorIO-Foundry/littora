require('reflect-metadata');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {normalizeReport}=require('../dist/modules/reports/report-input');
const {ContributionsService}=require('../dist/modules/reports/contributions.service');
const {ReportsService}=require('../dist/modules/reports/reports.service');
const {presentReport}=require('../dist/http/presenters');

const now=Date.parse('2026-11-17T12:00:00Z');
const dto={beachId:'10000000-0000-4000-8000-000000000001',type:'flag',value:{flag:'vert',source:'official'},confidence:1};
test('contestation: only a private other report can refer to a published observation',()=>{
  const value={contests:dto.beachId};
  assert.deepEqual(normalizeReport({...dto,type:'other',value},now).value,value);
  for(const input of [{...dto,type:'crowd',value},{...dto,type:'other',value:{contests:'unknown'}}]){
    assert.throws(()=>normalizeReport(input,now),e=>e.getStatus()===400);
  }
});
test('contributions: server strips client provenance and confidence, normalizes one unambiguous flag',()=>{
  assert.deepEqual(normalizeReport(dto,now),{beachId:dto.beachId,type:'flag',value:{flag:'green'},observedAt:'2026-11-17T12:00:00.000Z'});
  for(const value of [{flag:'blue'},{flag:'green',drapeau:'rouge'},{}]) assert.throws(()=>normalizeReport({...dto,value},now),e=>e.getStatus()===400);
  assert.throws(()=>normalizeReport({...dto,type:'jellyfish'},now),e=>e.getStatus()===400);
  assert.throws(()=>normalizeReport({...dto,type:'other',value:{}},now),e=>e.getStatus()===400);
  assert.throws(()=>normalizeReport({...dto,type:'jellyfish',value:{severity:'official'}},now),e=>e.getStatus()===400);
});
test('contributions: reject invalid, expired and future observations, clamp small clock skew',()=>{
  for(const observedAt of ['invalid','2026-11-18T12:00:00Z','2026-11-16T12:00:00Z']) {
    assert.throws(()=>normalizeReport({...dto,observedAt},now),e=>e.getStatus()===400);
  }
  assert.equal(normalizeReport({...dto,observedAt:'2026-11-17T12:00:20Z'},now).observedAt,'2026-11-17T12:00:00.000Z');
});
test('contributions: missing secret or invalid network fails closed before database access',async()=>{
  const original=process.env.REPORT_IP_HASH_KEY;
  const service=new ContributionsService({connect:()=>assert.fail('No DB access')});
  try{
    for(const key of ['', 'short', ' '.repeat(64)]){
      process.env.REPORT_IP_HASH_KEY=key;
      await assert.rejects(service.session('127.0.0.1'),e=>e.getStatus()===503);
    }
    process.env.REPORT_IP_HASH_KEY='test-only-secret-12345678901234567890';
    await assert.rejects(service.session('forged-client'),e=>e.getStatus()===503);
    await assert.rejects(service.submit(dto,{address:'127.0.0.1',token:'forged'}),e=>e.getStatus()===401);
  }finally{if(original===undefined)delete process.env.REPORT_IP_HASH_KEY;else process.env.REPORT_IP_HASH_KEY=original;}
});
test('contributions: public presentation never exposes token, network or contributor identifiers',()=>{
  const result=presentReport({id:dto.beachId,beach_id:dto.beachId,type:'flag',value:{flag:'red'},confidence:0,status:'pending',created_at:new Date(now),
    token_hash:'private-token',network_hash:'private-network',contributor_id:'private-actor',is_demo:false});
  assert.ok(!JSON.stringify(result).includes('private-'));
  assert.equal(result.provenance.verified,false);
  assert.equal(result.confidence,0);
});
test('contributions: storage failure returns unavailable without connection details',async()=>{
  const previous=process.env.REPORT_IP_HASH_KEY;
  process.env.REPORT_IP_HASH_KEY='isolated-storage-failure-secret-123456';
  try{
    const service=new ContributionsService({connect:async()=>{throw new Error('postgres://private-secret');}});
    await assert.rejects(service.session('127.0.0.1'),e=>e.getStatus()===503&&!e.message.includes('private-secret'));
  }finally{if(previous===undefined)delete process.env.REPORT_IP_HASH_KEY;else process.env.REPORT_IP_HASH_KEY=previous;}
});
test('contributions: pending and demo reports are excluded from all public aggregates',async()=>{
  const service=new ReportsService({query:async sql=>{
    assert.match(sql,/status='verified'/);assert.match(sql,/->>'demo'/);assert.match(sql,/expires_at/);
    return {rows:[]};
  }});
  await service.list(dto.beachId);await service.aggregate(dto.beachId);assert.equal(await service.flagConsensus(dto.beachId),null);
});
