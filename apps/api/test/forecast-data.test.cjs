require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fetchZone, retryPolicy, ProviderFailure } = require('../dist/jobs/forecast-collector');
const { readForecast, normalizeForecast } = require('../dist/shared/forecast-data');
const { WeatherService } = require('../dist/modules/weather/weather.service');
const { MarineService } = require('../dist/modules/marine/marine.service');
const { TidesService } = require('../dist/modules/tides/tides.service');
const target = { source: 'open-meteo', y: 4300, x: 600 };
const now = Date.parse('2026-07-15T12:00:00Z');

test('collection: UTC, source units, partial results and the current forecast hour advance without another HTTP call', async t => {
  t.mock.method(Date,'now',()=>now);
  const payload = await fetchZone(target, async (url,options) => {
    assert.equal(url.searchParams.get('timeformat'),'unixtime');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({hourly_units:{temperature_2m:'°C'},hourly:{time:[now/1000,now/1000+3600],temperature_2m:[0,19]}});
  });
  const row = { payload, last_success_at: new Date(now), next_check_at: new Date(now+21600000) };
  const first = readForecast(target.source,row,now);
  assert.equal(first.status,'partial'); assert.equal(first.current.temperature_2m,0);
  assert.equal(first.current.uv_index,null); assert.equal(first.producedAt,null);
  const later = readForecast(target.source,row,now+3600000);
  assert.equal(later.current.temperature_2m,19); assert.equal(later.ageSeconds,3600);
  assert.notEqual(first.validAt,later.validAt); assert.equal(first.fetchedAt,later.fetchedAt);
  const stale = readForecast(target.source,{...row,error_code:'http_503'},now);
  assert.equal(stale.status,'stale'); assert.equal(stale.fetchedAt,first.fetchedAt);
  const expired = readForecast(target.source,row,now+86400000);
  assert.equal(expired.status,'unknown'); assert.equal(expired.raw,undefined); assert.equal(expired.current.temperature_2m,null);
});

test('collection: timeout, rate limit, server error and empty payload fail once with bounded retries',async t=>{
  const controller = new AbortController();
  t.mock.method(AbortSignal,'timeout',ms=>{assert.equal(ms,8000);return controller.signal;});
  const timeout = fetchZone(target,async (_,opt)=>new Promise((_,reject)=>opt.signal.addEventListener('abort',()=>reject(Error('aborted')))));
  controller.abort();
  await assert.rejects(timeout,{code:'timeout'});
  AbortSignal.timeout.mock.restore();
  for(const [status,code] of [[429,'http_429'],[503,'http_503'],[200,'empty']]) {
    let count=0;
    await assert.rejects(fetchZone(target,async()=>{count++;return Response.json({}, {status,headers:{'retry-after':'900'}});}),{code});
    assert.equal(count,1);
  }
  const limited=new ProviderFailure('http_429',900);
  assert.deepEqual(retryPolicy(limited,0),{delay:900,pause:900});
  for(const code of ['timeout','http_503','network'])
    assert.deepEqual([0,1,2,3,4].map(n=>retryPolicy(new ProviderFailure(code),n).delay),[60,120,240,21600,21600]);
  assert.equal(retryPolicy(new ProviderFailure('empty'),0).delay,21600);
  for(const v of [{},{hourly:{time:[null],temperature_2m:[15]}},{hourly:{time:[now/1000],temperature_2m:[null]}}])
    assert.throws(()=>normalizeForecast(target.source,v),/empty/);
});

test('public reads never fetch, invent marine observations or relabel Open-Meteo as a direct Meteo-France source',async t=>{
  t.mock.method(global,'fetch',()=>assert.fail('HTTP consultations must stay offline'));
  const store={get:async source=>readForecast(source)};
  const data=await new WeatherService(store).getMeteoFrance(43,6);
  assert.equal(data.provider,'open-meteo');assert.equal(data.requestedProvider,'meteofrance');
  for(const d of [data,await new MarineService(store).get(43,6)]) {
    assert.equal(d.status,'unknown');assert.equal(d.fetchedAt,null);assert.equal(d.validAt,null);
    assert.ok(Object.values(d.current).every(v=>v===null));
  }
  assert.equal((await new TidesService().get(43,6)).status,'unknown');
});
