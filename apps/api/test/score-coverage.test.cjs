const {test}=require('node:test');
const assert=require('node:assert/strict');
const {summarize,history,intervalMs,dispatchEvidence}=require('../dist/jobs/score-coverage');
const {calmProjection}=require('./fixtures.cjs');

test('score coverage: six profiles, actual zero, closure, missing projection and overlapping reasons',()=>{
  const p=calmProjection(), now=Date.now();
  const site={id:'1',lat:43,lon:6,waterType:'sea',closed:false,airAt:null,seaAt:null};
  const bad=structuredClone(p);
  bad.weather.wind_speed_10m=null;
  bad.dataStatus.weather.units.uv_index='unknown';
  bad.dataStatus.marine.status='stale';
  const rough=structuredClone(p);rough.marine.wave_height=8;
  const sites=[site,{...site,id:'2',airAt:new Date(now+1)},{...site,id:'3'},
    {...site,id:'4',waterType:'lake'},{...site,id:'5',closed:true}];
  const r=summarize(sites,[rough,bad,null,null,null],now);
  assert.equal(r.awaitingProjection,1); assert.equal(r.noProjection,3);
  assert.equal(r.marineSites,4); assert.equal(Object.keys(r.byUsage).length,6);
  assert.deepEqual(r.byUsage.bathing,{calculated:1,partial:1,insufficient:1,closed:1,'not-applicable':1,
    reasons:{noProjection:1,stale:1,missing:1,invalid:1}});
  assert.equal(r.byUsage.windsurf.reasons.invalid,0,'UV is not a sailing input');
  assert.equal(r.byUsage.catamaran.insufficient,2);
  assert.throws(()=>summarize([],[],now),/Incomplete/);
  assert.throws(()=>summarize(sites,[],now),/Incomplete/);
});

test('score history: missing intervals remain unobserved and a cache error is never zero coverage',async()=>{
  const r=await history({mget:async(...keys)=>{assert.equal(keys.length,2);return [null,'{"sites":2}'];}},2,intervalMs*10);
  assert.deepEqual(r.map(v=>v.sample),[null,{sites:2}]);
  await assert.rejects(history({},673),/Invalid history size/);
  await assert.rejects(history({mget:async()=>{throw Error('offline');}},1),/offline/);
});

test('collector evidence: idle, shared active backlog, absent attempts and explicit cooldown are distinct',()=>{
  const now=Date.now(), idle={overdue:0,lastAttemptAt:null,dispatchDelayed:false};
  assert.equal(dispatchEvidence([idle],now),'no-significant-backlog');
  assert.equal(dispatchEvidence([{...idle,overdue:1}],now),'backlog-without-recent-attempt');
  assert.equal(dispatchEvidence([{...idle,overdue:1},{...idle,lastAttemptAt:new Date(now)}],now),'backlog-with-recent-attempt');
  assert.equal(dispatchEvidence([{...idle,overdue:1,dispatchDelayed:true}],now),'cooldown');
});
