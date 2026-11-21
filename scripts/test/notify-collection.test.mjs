import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deliver, inspectCollection, notify } from '../notify-collection.mjs';

const id = 'c'.repeat(64);
const ok = { status: 'ok', alerts: [] };
const start = Date.UTC(2026, 0, 1);
function inspect(status, body, container = id) {
  return inspectCollection((cmd, args) => {
    assert.equal(cmd, 'docker');
    if (args[0] === 'ps') {
      assert.ok(args.includes('label=com.docker.compose.project=littora-prod'));
      assert.ok(args.includes('label=com.docker.compose.service=worker'));
      assert.ok(args.includes('label=com.docker.compose.oneoff=False'));
      return { status: 0, stdout: container + '\n' };
    }
    assert.deepEqual(args, ['exec', id, 'node', 'scripts/forecast-check.cjs']);
    return { status, stdout: body };
  });
}
function privateDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'collection-notification-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('worker absent, ambiguous, timed out, malformed or inconsistent never indicates recovery', () => {
  assert.equal(inspect(0, JSON.stringify(ok)), 'ok');
  for (const args of [[0, JSON.stringify(ok), ''], [0, JSON.stringify(ok), id + '\n' + id],
    [null, ''], [1, ''], [2, JSON.stringify(ok)], [0, 'broken'], [0, '{}'],
    [2, '{"status":"alert","alerts":[]}'], [2, '{"status":"alert","alerts":[{"code":"private"}]}']]) {
    assert.equal(inspect(...args), 'check_unavailable');
  }
  assert.equal(inspectCollection(() => ({ status: null, error: Error('docker unavailable') })), 'check_unavailable');
});

test('outage to recovery: only fixed codes leave the host, no duplicates, even across restarts', t => {
  const dir = privateDir(t), inbox = [];
  const send = event => deliver(event, (cmd, args, msg) => {
    assert.equal(cmd, '/usr/sbin/sendmail');
    assert.deepEqual(args, ['-oi', 'littora-astreinte']);
    inbox.push(msg);
    return { status: 0 };
  });
  const sample = (codes, time) => notify(dir, inspect(codes.length ? 2 : 0, JSON.stringify({
    status: codes.length ? 'alert' : 'ok', alerts: codes.map(code => ({ code, source: 'private-marker' }))
  })), start + time, send);
  sample([], 0);
  sample(['queue_paused', 'provider_error', 'provider_error'], 1);
  sample(['provider_error', 'queue_paused'], 60000);
  assert.equal(inbox.length, 1);
  assert.match(inbox[0], /Subject: Littora \/ collecte \/ provider_error,queue_paused\n/);
  sample(['queue_paused', 'provider_error'], 3600001);
  notify(dir, 'check_unavailable', start + 3800000, send);
  sample([], 3900000);
  sample([], 4000000);
  assert.equal(inbox.length, 4);
  assert.match(inbox[2], /check_unavailable/);
  assert.match(inbox[3], /collecte \/ ok\n/);
  assert.doesNotMatch(inbox.join(''), /private-marker/);
  const path = join(dir, 'collection.json');
  assert.doesNotMatch(readFileSync(path, 'utf8'), /private-marker/);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('notification rejected by the relay survives recovery and is retried first', t => {
  const dir = privateDir(t), received = [];
  assert.throws(() => notify(dir, 'provider_error', start,
    event => deliver(event, () => ({ status: 75 }))), /not accepted/);
  notify(dir, 'ok', start + 60000, e => received.push(e));
  assert.deepEqual(received, [{ condition: 'provider_error', since: start }, { condition: 'ok', since: start + 60000 }]);
});

test('invalid private state never gets copied to the mail channel or silently replaced', t => {
  const dir = privateDir(t);
  const path = join(dir, 'collection.json');
  const invalid = '{"accepted":null,"pending":{"condition":"private-marker","since":1}}';
  writeFileSync(path, invalid);
  let sent = false;
  assert.throws(() => notify(dir, 'ok', start, () => { sent = true; }), /Invalid notification state/);
  assert.equal(sent, false);
  assert.equal(readFileSync(path, 'utf8'), invalid);
});
