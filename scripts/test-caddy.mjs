// Runs from the visitor network with the disposable Caddy root as its only extra CA.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const base = 'https://littora.internal';
const id = process.env.TEST_BEACH_ID;
const get = (url, options) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...options });
const redirect = await get('http://littora.internal/api/beaches?limit=1');
assert.equal(redirect.status, 308);
assert.equal(redirect.headers.get('location'), base + '/api/beaches?limit=1');
for (const path of ['/', '/recherche', '/plages/' + id]) {
  const page = await get(base + path);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  assert.match(html, /<app-root\b/);
  assert.equal(createHash('sha256').update(html).digest('hex'), process.env.TEST_INDEX_SHA256,
    'HTTPS must serve the index of the selected release on direct links');
}
const page = await get(base + '/api/beaches?limit=1', { headers: { Origin: base } });
assert.equal(page.status, 200);
assert.equal(page.headers.get('access-control-allow-origin'), base);
assert.equal((await page.json()).length, 1);
const beach = await get(base + '/api/beaches/' + id, { headers: { Origin: 'https://other.invalid' } });
assert.equal((await beach.json()).id, id);
assert.equal(beach.headers.get('access-control-allow-origin'), null);
for (const path of ['/api', '/api/no-such-route']) {
  const missing = await get(base + path);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'NOT_FOUND');
}
