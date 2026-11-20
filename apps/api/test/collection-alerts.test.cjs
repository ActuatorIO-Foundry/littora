const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CollectionSignals, ForecastCollectionFailure } = require('../dist/jobs/collection-signals');
const { inspect, officialAlerts } = require('../scripts/forecast-check.cjs');

test('worker incidents: bounded reasons, per-source throttling, no alert for a disabled or cached product', async () => {
  let now = 100000;
  const events = [], signals = new CollectionSignals(line => events.push(JSON.parse(line)), () => now);
  for (const [task, state] of [['vigilance','disabled'],['shom','cached'],['shom','cooldown'],['collect',{collected:0}]])
    assert.equal(await signals.run(task, async () => state), state);
  assert.deepEqual(events, []);
  for (const status of ['rate_limited','rate_limited','unauthorized'])
    await signals.run('vigilance', async () => status);
  await signals.run('shom', async () => 'unavailable');
  now += 300000;
  await signals.run('vigilance', async () => 'rate_limited');
  const fail = async () => { throw new ForecastCollectionFailure('open-meteo-marine', 'http_503'); };
  await assert.rejects(signals.run('collect', fail), /^Error: Collection job failed$/);
  await assert.rejects(signals.run('project', async () => { throw Error('private-diagnostic'); }), /^Error: Collection job failed$/);
  signals.jobFailure('private-diagnostic');
  signals.workerFailure('weather_queue');
  assert.deepEqual(events.map(e => [e.event,e.component,e.reason]), [
    ['provider_failure','meteo-france-vigilance','rate_limited'], ['provider_failure','meteo-france-vigilance','unauthorized'],
    ['provider_failure','shom','unavailable'], ['provider_failure','meteo-france-vigilance','rate_limited'],
    ['provider_failure','open-meteo-marine','unavailable'], ['job_failure','unknown','failed'],
    ['worker_failure','weather_queue','unavailable'],
  ]);
  assert.ok(events.every(e => Object.keys(e).sort().join(',') === 'at,component,event,reason'));
});

test('official products: quota and unavailable stations stay visible after the job completes; no key is not an outage', async () => {
  const now = 20000000;
  const sample = (bulletin, pause, failed) => ({mget:async (_v,_c,...keys) => [
    JSON.stringify(bulletin),pause,...keys.map((station,i) => JSON.stringify({station,checked:i===0 && failed ? 0 : now}))]});
  assert.deepEqual(await officialAlerts(sample({reason:'disabled'},null,false),false,now),[]);
  assert.deepEqual(await officialAlerts(sample({reason:'rate_limited'},'true',true),true,now),[
    {code:'provider_error',source:'meteo-france-vigilance',reason:'rate_limited'},
    {code:'provider_cooldown',source:'shom'}, {code:'provider_error',source:'shom',stations:1}
  ]);
  assert.deepEqual(await officialAlerts(sample({bulletin:{fetched:now}},null,false),true,now),[]);
  assert.deepEqual(await officialAlerts({mget:async (...keys)=>keys.map(()=>null)},true,now),
    [{code:'no_recent_check',source:'meteo-france-vigilance'},{code:'no_recent_check',source:'shom'}]);
});

test('probe: freshness, heartbeat, queue thresholds, recent events expire and missing dependencies fail closed', async () => {
  const now = 2_000_000;
  const rows = [{source:'open-meteo',zones:10,neverCollected:1,stale:2,errors:0}];
  const db = {query: async () => ({rows})};
  const q = {name:'littora-weather',waitUntilReady:async()=>{},getFailed:async()=>[{finishedOn:now-900000}],
    isPaused:async()=>false,getWaitingCount:async()=>29};
  assert.deepEqual(await inspect(db,[q],now,now), {status:'ok',alerts:[]});
  Object.assign(rows[0],{errors:2,stale:9});
  const bad = await inspect(db,[{...q,getFailed:async()=>[{finishedOn:now-899999,failedReason:'private-diagnostic'}],
    isPaused:async()=>true,getWaitingCount:async()=>30}], now-120000,now);
  assert.equal(bad.status,'alert');
  assert.deepEqual(bad.alerts.map(a=>a.code),['worker_silent','provider_error','no_recent_forecast','recent_job_failure','queue_paused','queue_backlog']);
  assert.ok(!JSON.stringify(bad).includes('private-diagnostic'));
  await assert.rejects(inspect(db,[{...q,getFailed:async()=>{throw Error('unavailable');}}],now,now));
  rows.pop();
  assert.deepEqual((await inspect(db,[],NaN,now)).alerts.map(a=>a.code),['worker_silent','no_forecast_targets']);
});
