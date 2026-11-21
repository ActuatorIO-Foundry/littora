const { test } = require('node:test');
const assert = require('node:assert/strict');
const { naturismAt, naturistSites } = require('../dist/modules/beaches/naturism');
const at = new Date('2026-12-01T10:00:00Z');

test('naturism: both scopes carry evidence, never inferred from a name or neighbouring beach', () => {
  const dedicated = naturistSites('dedicated', at), sections = naturistSites('section', at);
  assert.ok(dedicated.includes('way/25661665'));
  assert.ok(sections.includes('relation/13587236'));
  assert.deepEqual(new Set(naturistSites('verified', at)), new Set([...dedicated,...sections]));
  for (const [scope,ids] of [['dedicated',dedicated], ['section',sections]]) for (const id of ids) {
    const info = naturismAt(id,at);
    assert.equal(info.status,scope); assert.match(info.sourceUrl,/^https:\/\//);
    assert.ok(info.source && info.detail && info.checkedOn);
  }
  for (const id of [null,'way/0','Plage naturiste','toString']) assert.deepEqual(naturismAt(id,at),{status:'unknown'});
});

test('naturism: dates of verification and expiry are inclusive in mainland local time', () => {
  const lookup = iso => naturismAt('way/25661665',new Date(iso)).status;
  assert.equal(lookup('2026-11-20T22:59:59Z'),'unknown');
  assert.equal(lookup('2026-11-20T23:00:00Z'),'dedicated');
  assert.equal(lookup('2027-11-20T22:59:59Z'),'dedicated');
  assert.deepEqual(naturistSites('verified',new Date('2027-11-20T23:00:00Z')),[]);
});
