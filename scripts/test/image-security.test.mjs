import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkReport } from '../check-image-report.mjs';

test('image policy: exceptions cannot hide unrelated, fixed or expired findings', () => {
  const item = { VulnerabilityID: 'CVE-test', PkgName: 'jose', InstalledVersion: '3', Severity: 'HIGH' };
  const report = (v = item) => ({ SchemaVersion: 2, Metadata: { OS: {} }, Results: [{ Vulnerabilities: [v] }] });
  const exceptions = [{ image: 'caddy', id: 'CVE-test', package: 'jose', version: '3', expires: '2026-11-30' }];
  assert.equal(checkReport('caddy', report(), exceptions, '2026-11-16').accepted.length, 1);
  for (const [image, finding, date] of [['api', item, '2026-11-16'], ['caddy', { ...item, FixedVersion: '4' }, '2026-11-16'],
    ['caddy', item, '2026-11-30'], ['caddy', { ...item, InstalledVersion: '2' }, '2026-11-16']]) {
    assert.equal(checkReport(image, report(finding), exceptions, date).blocked.length, 1);
  }
  assert.throws(() => checkReport('caddy', {}, exceptions), /Incomplete/);
});

test('production stays blocked while an infrastructure exception remains', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../start-production.mjs', import.meta.url))], {
    encoding: 'utf8', env: { ...process.env, PATH: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Production blocked/);
});
