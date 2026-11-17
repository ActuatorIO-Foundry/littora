require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ReportsService } = require('../dist/modules/reports/reports.service');
const { flagConsensus } = require('../dist/modules/reports/flag-consensus');
const now=Date.parse('2026-07-15T13:05:00Z');
const observation=(flag,id,time='2026-07-15T13:00:00Z')=>({id:String(id),value:{flag},status:'verified',
  contributor_id:'actor-'+id,network_hash:'network-'+id,created_at:time,observed_at:time});

test('flags: no observations means no community consensus', async () => {
  const service = new ReportsService({ query: async () => ({ rows: [] }) });
  assert.equal(await service.flagConsensus('test'), null);
});

test('flags: later green reports preserve the earlier red in history', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-07-15T13:05:00Z'));
  const rows = [
    ...Array.from({ length: 5 }, (_,i) => observation('vert',i)),
    observation('rouge',5,'2026-07-15T12:00:00Z'),
  ];
  const service = new ReportsService({ query: async (sql, params) => {
    assert.deepEqual(params, ['test']);
    assert.ok(sql.includes("interval '12 hours'"));
    return { rows };
  } });
  const result = await service.flagConsensus('test');
  assert.equal(result.flag, 'green');
  assert.deepEqual(result.counts, { green: 5, yellow: 0, red: 1 });
  assert.ok(result.history.some((item) => item.flag === 'red' && item.time === new Date(rows[5].created_at).toISOString()));
  assert.equal(result.status,'consensus');assert.equal(result.participants,6);assert.equal(result.agreement,.83);
});

test('flags: an isolated green has no majority or confidence percentage',()=>{
  const result=flagConsensus([observation('green',1)],now);
  assert.equal(result.flag,null);assert.equal(result.confidence,0);assert.equal(result.agreement,null);
  assert.equal(result.status,'insufficient');assert.equal(result.participants,1);
});
test('flags: repeated sessions and shared networks count only once',()=>{
  const repeated=Array.from({length:20},(_,i)=>({...observation('green',i),contributor_id:'one-actor'}));
  assert.equal(flagConsensus(repeated,now).participants,1);
  const network=Array.from({length:20},(_,i)=>({...observation('green',i),network_hash:'one-network'}));
  assert.equal(flagConsensus(network,now).participants,1);
  const latest=flagConsensus([observation('red',1,'2026-07-15T12:00:00Z'),observation('green',1)],now);
  assert.equal(latest.counts.green,1);assert.equal(latest.counts.red,0);assert.ok(latest.recentRedAt);
  const legacy={...observation('green',1),contributor_id:null,network_hash:null};
  assert.equal(flagConsensus([legacy],now).participants,0);
});
test('flags: ties, future, expired, pending and demo observations never create consensus',()=>{
  const tie=flagConsensus([observation('green',1),observation('green',2),observation('red',3),observation('red',4)],now);
  assert.equal(tie.flag,null);assert.equal(tie.status,'conflicting');
  for(const row of [observation('green',1,'2026-07-15T13:06:00Z'),observation('green',1,'2026-07-15T00:00:00Z'),
    {...observation('green',1),status:'pending'},{...observation('green',1),value:{flag:'green',demo:true}},
    observation('__proto__',1),observation('constructor',1),
    {...observation('green',1),expires_at:'2026-07-15T13:00:00Z'}])assert.equal(flagConsensus([row],now),null);
  const old=flagConsensus([observation('red',1,'2026-07-15T09:00:00Z')],now);
  assert.equal(old.participants,0);assert.equal(old.history[0].flag,'red');
});
test('flags: red history survives a long green sequence, capped input cannot imply agreement',()=>{
  const rows=[...Array.from({length:20},(_,i)=>observation('green',i)),observation('red',21,'2026-07-15T12:00:00Z')];
  assert.equal(flagConsensus(rows,now).history.at(-1).flag,'red');
  const capped=flagConsensus(Array.from({length:1001},(_,i)=>observation('green',i)),now);
  assert.equal(capped.flag,null);assert.equal(capped.status,'capped');assert.equal(capped.confidence,0);
  assert.ok(!JSON.stringify(flagConsensus(rows,now)).includes('network-'));
});

test('flags: unknown values do not create a green default', async () => {
  const service = new ReportsService({ query: async () => ({ rows: [
    { value: { flag: 'unknown' }, confidence: 1, created_at: new Date().toISOString() },
  ] }) });
  assert.equal(await service.flagConsensus('test'), null);
});
