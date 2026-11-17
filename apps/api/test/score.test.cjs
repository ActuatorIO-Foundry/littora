const assert = require('node:assert/strict');
const { test } = require('node:test');
const { beach, scoreFixture } = require('./fixtures.cjs');

test('scores: finite values within 0..100 when all inputs are available', async () => {
  const result = await scoreFixture().scoreBeach(beach.id);
  for (const value of Object.values(result.scores)) {
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 100);
  }
  assert.equal(result.safety.official, false);
  assert.equal(result.providers.weather, 'test-weather');
});

test('scores: pollution lowers bathing score and remains an explicit warning', async () => {
  const normal = await scoreFixture().scoreBeach(beach.id);
  const poor = await scoreFixture({ quality: 'poor' }).scoreBeach(beach.id);
  assert.ok(poor.scores.bathing < normal.scores.bathing);
  assert.ok(poor.safety.alerts.some((alert) => alert.includes('Qualité')));
});

test('scores: community warnings remain non-official and are deduplicated', async () => {
  const result = await scoreFixture({ reports: [
    { type: 'jellyfish', count: 2, confidence: 0.5 },
    { type: 'jellyfish', count: 1, confidence: 0.5 },
  ] }).scoreBeach(beach.id);
  assert.equal(result.safety.official, false);
  assert.equal(result.safety.alerts.filter((alert) => alert.includes('méduses')).length, 1);
});

test('forecast: unavailable series are empty, not fabricated', async () => {
  assert.deepEqual((await scoreFixture().scoreBeach(beach.id)).forecast, {
    uv: [], air: [], water: [], wave: [],
  });
});

test('forecast: real zero is preserved but null is not converted into zero', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-07-15T12:00:00Z'));
  const result = await scoreFixture({ weather: { raw: { hourly: {
    time: ['2026-07-15T12:00:00Z', '2026-07-15T13:00:00Z'],
    temperature_2m: [0, null],
  } } } }).scoreBeach(beach.id);
  assert.deepEqual(result.forecast.air, [{ time: '2026-07-15T12:00:00Z', value: 0 }]);
});

test('scores: no bathing score without weather and marine coverage', async () => {
  const result = await scoreFixture({ weather: { current: {} }, marine: { current: {} } }).scoreBeach(beach.id);
  assert.equal(result.scores.bathing, null);
  assert.equal(result.safety.flag, 'unknown');
  assert.ok(Object.values(result.scores).every(value => value === null));
});

test('scores: stale data remains attributed but is excluded from recommendations', async () => {
  const result = await scoreFixture({ weather: { status: 'stale', fetchedAt: '2026-07-15T12:00:00Z', ageSeconds: 1800 } }).scoreBeach(beach.id);
  assert.equal(result.current.weather.temperature_2m, 24);
  assert.equal(result.dataStatus.weather.status, 'stale');
  assert.equal(result.dataStatus.weather.ageSeconds, 1800);
  assert.equal(result.providers.weather, 'test-weather');
  assert.ok(Object.values(result.scores).every(value => value === null));
});

test('scores: missing water temperature never becomes 22 degrees', async () => {
  const result = await scoreFixture({ marine: { current: { wave_height: 0.3, ocean_current_velocity: 0.05 } } }).scoreBeach(beach.id);
  assert.equal(result.scores.bathing, null);
  assert.equal(result.scores.family, null);
  assert.ok(Number.isFinite(result.scores.paddle));
});
