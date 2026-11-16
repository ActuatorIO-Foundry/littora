require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ReportsService } = require('../dist/modules/reports/reports.service');

test('flags: no observations means no community consensus', async () => {
  const service = new ReportsService({ query: async () => ({ rows: [] }) });
  assert.equal(await service.flagConsensus('test'), null);
});

test('flags: later green reports preserve the earlier red in history', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-07-15T13:05:00Z'));
  const rows = [
    ...Array.from({ length: 5 }, () => ({
      value: { flag: 'vert' }, confidence: 0.5, created_at: '2026-07-15T13:00:00Z',
    })),
    { value: { flag: 'rouge' }, confidence: 0.5, created_at: '2026-07-15T12:00:00Z' },
  ];
  const service = new ReportsService({ query: async (sql, params) => {
    assert.deepEqual(params, ['test']);
    assert.ok(sql.includes("interval '12 hours'"));
    return { rows };
  } });
  const result = await service.flagConsensus('test');
  assert.equal(result.flag, 'green');
  assert.deepEqual(result.counts, { green: 5, yellow: 0, red: 1 });
  assert.ok(result.history.some((item) => item.flag === 'red' && item.time === rows[5].created_at));
});

test('flags: unknown values do not create a green default', async () => {
  const service = new ReportsService({ query: async () => ({ rows: [
    { value: { flag: 'unknown' }, confidence: 1, created_at: new Date().toISOString() },
  ] }) });
  assert.equal(await service.flagConsensus('test'), null);
});
