import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countIndicators } from '../check-private-logs.mjs';

test('log triage returns counts only, including historical location and SQL indicators', () => {
  const text = ['{"event":"database_error"}','Authorization: Bearer syntheticfixture',
    '/recherche?lat=42.123', 'redis://test:example@localhost', 'DETAIL:  parameters: synthetic',
    'Weather job failed 1 open-meteo 4300/600: timeout', 'fixture@example.invalid'].join('\n');
  assert.deepEqual(countIndicators(text), {lines:7,flagged:6,categories:{credential:1,location:2,connection:1,sql:1,email:1}});
  assert.deepEqual(countIndicators(''), {lines:0,flagged:0,categories:{}});
});
