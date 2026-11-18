const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { manifest, status, assertCurrent, seed } = require('../scripts/database.cjs');

test('migrations: consecutive immutable SQL manifest', t => {
  const migrations = manifest();
  assert.equal(migrations.length, 8);
  for (const item of migrations) {
    assert.equal(item.checksum, createHash('sha256').update(item.sql).digest('hex'));
  }
  const directory = mkdtempSync(join(tmpdir(), 'littora-migrations-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => manifest(directory), /No SQL/);
  writeFileSync(join(directory, '0002_gap.sql'), 'select 1;');
  assert.throws(() => manifest(directory), /consecutively/);
});

test('migrations: status and startup verification are strictly read-only', async () => {
  const client = { query: async sql => {
    assert.match(sql, /^select /i);
    return { rows: [{ name: null }] };
  } };
  assert.equal((await status(client)).filter(m => !m.applied).length, 8);
  await assert.rejects(assertCurrent(client), /Database migrations required/);
});

test('migrations: reject changed, missing and nonconsecutive applied history', async () => {
  const migrations = manifest();
  for (const history of [
    [{ ...migrations[0], checksum: 'changed' }],
    [migrations[1]],
    [...migrations, { version: 9, name: '0009_unknown.sql', checksum: 'unknown' }],
  ]) {
    const client = { query: async sql => ({ rows: sql.includes('to_regclass') ? [{ name: 'schema_migrations' }] : history }) };
    await assert.rejects(status(client), /history differs/);
  }
});

test('seed: demo is refused before connecting without explicit nonproduction opt-in', async () => {
  const pool = { connect: () => assert.fail('Must not connect') };
  await assert.rejects(seed(pool, { demo: true, env: {} }), /ALLOW_DEMO_SEED/);
  await assert.rejects(seed(pool, { demo: true, env: { NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true' } }), /outside production/);
});
