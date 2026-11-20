import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';

const base = new URL(process.argv[2] || 'http://127.0.0.1:4200');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.pathname !== '/' || base.username || base.password || base.search || base.hash) throw new Error('Expected a local HTTP origin');

async function read(criteria) {
  const start = performance.now(), ids = new Set(), cursors = new Set(), pages = [];
  let cursor, asOf, total;
  const facts = createHash('sha256');
  do {
    const t = performance.now();
    const res = await fetch(new URL('/api/search/beaches', base), { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ ...criteria, limit: 200, ...(cursor ? { cursor } : {}) }) });
    assert.equal(res.status, 200);
    const p = await res.json();
    pages.push(performance.now() - t);
    asOf ??= p.asOf;
    total ??= p.total;
    assert.ok(Number.isSafeInteger(total) && total > 0 && p.asOf);
    assert.equal(p.asOf, asOf);
    assert.equal(p.total, total);
    assert.equal(p.items.length, Math.min(200, total - ids.size));
    for (const b of p.items) {
      assert.ok(!ids.has(b.id));
      ids.add(b.id);
      facts.update(JSON.stringify([b.id, b.waterType, b.facilities, b.distanceKm]));
    }
    cursor = p.pageInfo.nextCursor;
    assert.equal(p.pageInfo.hasNextPage, cursor !== null);
    if (cursor) { assert.ok(ids.size < total && !cursors.has(cursor)); cursors.add(cursor); }
  } while (cursor);
  assert.equal(ids.size, total);
  return { total, hash: facts.digest('hex'), first: pages[0], cursors: pages.slice(1), complete: performance.now() - start };
}

const cases = [
  { scope: 'bandol-bbox', criteria: { bbox: '43.12,5.70,43.16,5.79' } },
  { scope: 'national', criteria: {} },
].map(c => ({ ...c, first: [], cursors: [], complete: [] }));
for (let i = -1; i < 40; i++) {
  for (const c of cases) {
    const r = await read(c.criteria);
    c.hash ??= r.hash;
    assert.equal(r.hash, c.hash, 'Catalogue/order/facilities changed during measurement');
    c.total = r.total;
    if (i >= 0) { c.first.push(r.first); c.cursors.push(...r.cursors); c.complete.push(r.complete); }
    await pause(500);
  }
}
function distribution(samples) {
  if (!samples.length) return null;
  samples.sort((a, b) => a - b);
  const q = p => Math.round(samples[Math.ceil(samples.length * p) - 1]);
  return { n: samples.length, p50Ms: q(.5), p95Ms: q(.95) };
}
for (const c of cases) console.log(JSON.stringify({ scope: c.scope, total: c.total, facts: c.hash,
  first: distribution(c.first), cursor: distribution(c.cursors), complete: distribution(c.complete) }));
