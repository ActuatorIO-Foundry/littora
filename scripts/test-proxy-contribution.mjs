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
if (process.argv.includes('--after-rollback')) {
  const next = process.env.TEST_NEXT_BEACH_ID;
  assert.ok(next && next !== report.beachId);
  const list = await fetch('https://littora.internal/api/reports?beachId=' + report.beachId,
    {redirect:'error',signal:AbortSignal.timeout(5000)});
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), [], 'Pending contributions must remain private after rollback');
  const token = await session();
  assert.equal((await post('', report, token)).status, 409, 'Rollback must preserve duplicate detection');
  const accepted = await post('', {...report,beachId:next}, token);
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).status, 'pending');
} else {
  const first = await post('', report, await session());
  assert.equal(first.status, 201);
  assert.equal((await first.json()).status, 'pending');
  const sameNetwork = await post('', report, await session());
  assert.equal(sameNetwork.status, 409);
}
