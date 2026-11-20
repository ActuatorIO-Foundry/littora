import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

test('repository: runtime logs, database dumps and local traces are never tracked', () => {
  const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
  const forbidden=files.filter(path=>/(^|\/)(logs|\.local|test-results|playwright-report)\/|\.log($|\.)|\.(dump|age|agekey)$|(^|\/)trace\.zip$/.test(path));
  assert.deepEqual(forbidden,[],'Keep runtime artifacts outside Git');
});
