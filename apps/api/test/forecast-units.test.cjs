require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('../dist/shared/http');
const { forecastData } = require('../dist/shared/forecast-data');
const { normalizeMetric } = require('../dist/shared/forecast-units');
const { MarineService } = require('../dist/modules/marine/marine.service');
const { scoreFixture, beach } = require('./fixtures.cjs');
const cache = { getJson: async () => null, setJson: async () => {} };

test('units: provider units convert to canonical values without guessing missing units', () => {
  assert.equal(normalizeMetric('ocean_current_velocity', 3.6, 'km/h'), 1);
  assert.equal(normalizeMetric('ocean_current_velocity', 1, 'm/s'), 1);
  assert.equal(normalizeMetric('ocean_current_velocity', 1, 'kn'), 1852 / 3600);
  assert.equal(normalizeMetric('wind_speed_10m', 10, 'm/s'), 36);
  assert.equal(normalizeMetric('temperature_2m', 32, '\u00b0F'), 0);
  assert.equal(normalizeMetric('wave_height', 10, 'ft'), 3.048);
  for (const value of [null, undefined, '', '3.6', NaN, Infinity, -1, 9999]) {
    assert.equal(normalizeMetric('ocean_current_velocity', value, 'km/h'), null);
  }
  for (const unit of [undefined, null, '', 'unknown', '__proto__', 'constructor']) {
    assert.equal(normalizeMetric('ocean_current_velocity', 3.6, unit), null);
  }
  assert.equal(normalizeMetric('uv_index', 0, ''), 0);
  assert.equal(normalizeMetric('relative_humidity_2m', 101, '%'), null);
  assert.equal(normalizeMetric('sea_surface_temperature', 90, '\u00b0C'), null);
});

test('units: the same normalized current reaches public metrics, series and scoring', async t => {
  const now = Date.parse('2026-07-15T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const fetch = t.mock.method(http, 'fetchJson', async () => ({
    hourly_units: { ocean_current_velocity: 'km/h', wave_height: 'm', sea_surface_temperature: '\u00b0C' },
    hourly: { time: [now / 1000], ocean_current_velocity: [3.6], wave_height: [0], sea_surface_temperature: [24] },
  }));
  const service = new MarineService(cache), marine = await service.get(43, 6);
  assert.equal(marine.current.ocean_current_velocity, 1);
  assert.equal(marine.raw.hourly.ocean_current_velocity[0], 1);
  assert.equal(marine.units.ocean_current_velocity, 'm/s');
  assert.equal(marine.sourceUnits.ocean_current_velocity, 'km/h');
  assert.equal(marine.producedAt, null);
  const result = await scoreFixture({ marine }).scoreBeach(beach.id);
  const expected = await scoreFixture({ marine: { current: { ocean_current_velocity: 1, wave_height: 0, sea_surface_temperature: 24 } } }).scoreBeach(beach.id);
  assert.deepEqual(result.scores, expected.scores);
  assert.equal(result.forecast.current[0].value, 1);
  assert.equal(result.dataStatus.marine.units.ocean_current_velocity, 'm/s');
  fetch.mock.mockImplementation(async () => ({
    hourly_units: { ocean_current_velocity: 'm/s', wave_height: 'm', sea_surface_temperature: '\u00b0C' },
    hourly: { time: [now / 1000], ocean_current_velocity: [1], wave_height: [0], sea_surface_temperature: [24] },
  }));
  assert.equal((await service.get(43, 6)).current.ocean_current_velocity, 1, 'No double conversion');
});

test('UTC: summer, winter, DST and midnight are independent of the server timezone', async t => {
  const original = process.env.TZ;
  t.after(() => { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; });
  let now;
  t.mock.method(Date, 'now', () => now);
  for (const tz of ['UTC', 'Europe/Paris']) {
    process.env.TZ = tz;
    for (const stamp of ['2026-07-15T23:40:00Z', '2026-01-15T23:40:00Z', '2026-03-29T00:40:00Z', '2026-10-25T00:40:00Z']) {
      now = Date.parse(stamp);
      const next = Math.ceil(now / 3600_000) * 3600_000;
      const payload = await forecastData(cache, 'test', 43, 6, ['temperature_2m'], async () => ({
        hourly_units: { temperature_2m: '\u00b0C' },
        hourly: { time: [(next - 3600_000) / 1000, next / 1000], temperature_2m: [20, 21] },
      }));
      assert.equal(payload.fetchedAt, new Date(now).toISOString());
      assert.equal(payload.validAt, new Date(next).toISOString());
      assert.equal(payload.current.temperature_2m, 21);
      assert.equal(payload.producedAt, null);
    }
  }
});

test('forecast: missing points keep their timestamp, expired forecasts are not recycled', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-07-15T12:00:00Z'));
  const result = await scoreFixture({ weather: { raw: { hourly: {
    time: ['2026-07-15T12:00:00Z', '2026-07-15T13:00:00Z', '2026-07-15T14:00:00Z'],
    temperature_2m: [0, null, 20],
  } } } }).scoreBeach(beach.id);
  assert.deepEqual(result.forecast.air.map(p => p.value), [0, null, 20]);
  const expired = await scoreFixture({ weather: { raw: { hourly: {
    time: ['2026-07-15T10:00:00Z'], temperature_2m: [18],
  } } } }).scoreBeach(beach.id);
  assert.deepEqual(expired.forecast.air, []);
});
