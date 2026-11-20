const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');

test('development: native watch starts the TypeScript API without the Nest CLI', { timeout: 30000 }, async (t) => {
  const reservation = createServer();
  await new Promise((done) => reservation.listen(0, '127.0.0.1', done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  const child = spawn(process.execPath, ['--watch', '--require', resolve(__dirname, 'fixtures/database-ready.cjs'), '--require', 'ts-node/register', 'src/main.ts'], {
    cwd: resolve(__dirname, '..'),
    env: {
      ...process.env, NODE_ENV: 'test', API_PORT: String(port), ADMIN_API_TOKEN: '', REDIS_URL: '',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/littora_ci_test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let spawnError;
  child.stdout.resume();
  child.stderr.resume();
  child.on('error', (error) => { spawnError = error; });
  const stopped = new Promise((done) => child.once('exit', done));
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null || spawnError) return;
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    force.unref();
    await stopped;
    clearTimeout(force);
  });

  for (let attempt = 0; attempt < 160; attempt++) {
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, 'Development server exited unexpectedly');
    let response;
    try {
      response = await fetch(`http://127.0.0.1:${port}/api/admin/health`, { signal: AbortSignal.timeout(200) });
    } catch {
      await delay(100);
      continue;
    }
    assert.equal(response.status, 503, 'Internal operations must still fail closed');
    const body = await response.json();
    assert.equal(body.code, 'UNAVAILABLE');
    assert.match(body.requestId, /^[a-f0-9-]{36}$/);
    return;
  }
  assert.fail('Development server did not start');
});
