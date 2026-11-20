import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';

// A repeatable loopback reading, not a load test or a public availability probe.
const base = new URL(process.argv[2] || 'http://127.0.0.1:4200');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:' ||
    base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('Expected a local HTTP origin');
}
async function read(path) {
  const start = performance.now();
  const response = await fetch(new URL('/api' + path, base), { redirect: 'error', signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  const data = await response.json();
  return { data, ms: performance.now() - start };
}
const catalogue = '/beaches/catalogue?limit=20';
const ids = (await read(catalogue)).data.beaches.map(b => b.id);
assert.equal(new Set(ids).size, 20, 'Requires a pilot catalogue of at least 20 distinct beaches');
const times = { catalogue: [], detail: [], reports: [] };
for (let sample = -1; sample < 40; sample++) {
  const id = ids[Math.max(0, sample) % ids.length];
  for (const [key, path] of [['catalogue', catalogue], ['detail', '/beaches/' + id], ['reports', '/reports?beachId=' + id]]) {
    const { data, ms } = await read(path);
    if (key === 'detail') assert.equal(data.id, id);
    else if (key === 'catalogue') assert.deepEqual(data.beaches.map(b => b.id), ids);
    else assert.ok(Array.isArray(data));
    if (sample >= 0) times[key].push(ms);
    await pause(250);
  }
}
for (const [route, samples] of Object.entries(times)) {
  samples.sort((a, b) => a - b);
  const percentile = p => Math.round(samples[Math.ceil(samples.length * p) - 1]);
  console.log(JSON.stringify({ route, requests: samples.length, p50Ms: percentile(.50), p95Ms: percentile(.95), maxMs: percentile(1) }));
}
