import assert from 'node:assert/strict';

const post = (path, body, token) => fetch('https://littora.internal/api/reports' + path, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(body),
});
async function session() {
  const response = await post('/session', {});
  assert.equal(response.status, 201);
  return (await response.json()).token;
}
const report = { beachId: process.env.TEST_BEACH_ID, type: 'crowd' };
const first = await post('', report, await session());
assert.equal(first.status, 201);
assert.equal((await first.json()).status, 'pending');
const sameNetwork = await post('', report, await session());
assert.equal(sameNetwork.status, 409);
