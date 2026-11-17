require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('../dist/shared/http');
const { WeatherService } = require('../dist/modules/weather/weather.service');
const { MarineService } = require('../dist/modules/marine/marine.service');
const { TidesService } = require('../dist/modules/tides/tides.service');
const now = Date.parse('2026-07-15T12:00:00Z');

function cache() {
  const entries = new Map();
  return { entries, getJson: async k => entries.get(k) ?? null, setJson: async (k, v, ttl) => {
    assert.equal(ttl, 86400); entries.set(k, structuredClone(v));
  } };
}

test('providers: outages never fabricate weather, marine metrics or tide events', async t => {
  t.mock.method(http, 'fetchJson', async () => { throw new Error('Private failure details'); });
  for (const service of [new WeatherService(cache()), new MarineService(cache())]) {
    const data = await service.get(43, 6);
    assert.equal(data.status, 'unknown');
    assert.equal(data.fetchedAt, null);
    assert.equal(data.validAt, null);
    assert.ok(Object.values(data.current).every(v => v === null));
    assert.equal(data.raw, undefined);
    assert.ok(!JSON.stringify(data).includes('Private failure'));
  }
  const originalKey = process.env.SHOM_API_KEY;
  t.after(() => {
    if (originalKey === undefined) delete process.env.SHOM_API_KEY;
    else process.env.SHOM_API_KEY = originalKey;
  });
  for (const key of ['', 'configured-key']) {
    process.env.SHOM_API_KEY = key;
    const data = await new TidesService().get(43, 6);
    assert.equal(data.status, 'unknown');
    assert.equal(data.reliability, 'unknown');
    assert.deepEqual(data.events, []);
  }
});

test('providers: partial real forecasts preserve zero, null, source and timestamps', async t => {
  t.mock.method(Date, 'now', () => now);
  t.mock.method(http, 'fetchJson', async url => {
    assert.equal(new URL(url).searchParams.get('timeformat'), 'unixtime');
    return { hourly_units: { temperature_2m: '\u00b0C', precipitation: 'mm', cloud_cover: '%', uv_index: '' }, hourly: { time: [now / 1000], temperature_2m: [0], precipitation: [null], cloud_cover: [''], uv_index: [Infinity] } };
  });
  const data = await new WeatherService(cache()).getOpenMeteo(43, 6);
  assert.equal(data.status, 'partial');
  assert.equal(data.current.temperature_2m, 0);
  assert.equal(data.current.precipitation, null);
  assert.equal(data.current.cloud_cover, null);
  assert.equal(data.current.uv_index, null);
  assert.equal(data.validAt, new Date(now).toISOString());
  assert.equal(data.provider, 'open-meteo');
});

test('providers: retain only last real forecast for 24h, with original age and validity', async t => {
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  const fetch = t.mock.method(http, 'fetchJson', async () => ({ hourly_units: { wave_height: 'm' }, hourly: { time: [now / 1000], wave_height: [0.4] } }));
  const store = cache(), service = new MarineService(store);
  const first = await service.get(43, 6);
  assert.equal(first.current.salinity_ppt, null);
  assert.equal(first.current.jellyfish_risk, null);
  fetch.mock.mockImplementation(async () => { throw new Error('Offline'); });
  clock += 60_000;
  assert.equal((await service.get(43, 6)).ageSeconds, 60);
  assert.equal(fetch.mock.callCount(), 1);
  clock = now + 900_000;
  const stale = await service.get(43, 6);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.ageSeconds, 900);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.equal(stale.validAt, first.validAt);
  assert.equal(stale.current.wave_height, 0.4);
  clock = now + 86400_000;
  assert.equal((await service.get(43, 6)).status, 'unknown');
});

test('providers: malformed data cannot overwrite a previous real forecast', async t => {
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  const fetch = t.mock.method(http, 'fetchJson', async () => ({ hourly_units: { temperature_2m: '\u00b0C' }, hourly: { time: [now / 1000], temperature_2m: [21] } }));
  const service = new WeatherService(cache());
  await service.getOpenMeteo(43, 6);
  clock += 1000_000;
  for (const raw of [{}, { hourly: { time: [null], temperature_2m: [20] } }, { hourly: { time: [now / 1000], temperature_2m: [null] } }]) {
    fetch.mock.mockImplementation(async () => raw);
    const data = await service.getOpenMeteo(43, 6);
    assert.equal(data.status, 'stale');
    assert.equal(data.current.temperature_2m, 21);
  }
});

test('providers: Meteo-France configuration never relabels Open-Meteo as a direct source', async t => {
  t.mock.method(http, 'fetchJson', async () => { throw new Error('Offline'); });
  const data = await new WeatherService(cache()).getMeteoFrance(43, 6);
  assert.equal(data.provider, 'open-meteo');
  assert.equal(data.requestedProvider, 'meteofrance');
  assert.equal(data.status, 'unknown');
});
