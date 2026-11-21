import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const codes = new Set(['worker_silent', 'no_forecast_targets', 'provider_error', 'no_recent_forecast',
  'recent_job_failure', 'queue_paused', 'queue_backlog', 'provider_cooldown', 'no_recent_check']);
const unknown = 'check_unavailable';
const reminder = 60 * 60 * 1000;
const alias = 'littora-astreinte';

function run(command, args, input) {
  return spawnSync(command, args, { input, encoding: 'utf8', timeout: 16000, killSignal: 'SIGKILL',
    maxBuffer: 32768, stdio: ['pipe', 'pipe', 'ignore'] });
}

export function inspectCollection(exec = run) {
  const ps = exec('docker', ['ps', '-q', '--no-trunc', '--filter', 'label=com.docker.compose.project=littora-prod',
    '--filter', 'label=com.docker.compose.service=worker', '--filter', 'label=com.docker.compose.oneoff=False']);
  const id = ps.stdout?.trim();
  if (ps.error || ps.status !== 0 || !/^[a-f0-9]{64}$/.test(id)) return unknown;
  const probe = exec('docker', ['exec', id, 'node', 'scripts/forecast-check.cjs']);
  if (probe.error || ![0, 2].includes(probe.status)) return unknown;
  try {
    const { status, alerts } = JSON.parse(probe.stdout);
    if (!Array.isArray(alerts)) return unknown;
    if (status === 'ok' && probe.status === 0 && !alerts.length) return 'ok';
    if (status === 'alert' && probe.status === 2 && alerts.length && alerts.every(a => codes.has(a?.code)))
      return [...new Set(alerts.map(a => a.code))].sort().join(',');
  } catch { /* Unreadable is not healthy. */ }
  return unknown;
}

export function deliver({ condition, since }, exec = run) {
  const message = [
    'To: ' + alias, 'Subject: Littora / collecte / ' + condition, '',
    'UTC: ' + new Date(since).toISOString(), 'Procedure: docs/architecture/INCIDENTS.md', ''
  ].join('\n');
  const result = exec('/usr/sbin/sendmail', ['-oi', alias], message);
  if (result.error || result.status !== 0) throw Error('Notification not accepted');
}

function validEvent(e) {
  if (!e || !Number.isSafeInteger(e.since) || e.since <= 0 || e.since > 8640000000000000 ||
      typeof e.condition !== 'string') return false;
  return ['ok', unknown].includes(e.condition) || e.condition.split(',').every(code => codes.has(code));
}

// Only the timer service writes this directory. Retain an unaccepted notification
// across restarts; a subsequent healthy sample must not erase a short outage.
export function notify(dir, condition, now, send = deliver) {
  const path = join(dir, 'collection.json');
  let state = { accepted: null, pending: null };
  try {
    state = JSON.parse(readFileSync(path, 'utf8'));
    if (!state || ![state.accepted, state.pending].every(e => e === null || validEvent(e)))
      throw Error('Invalid notification state');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const save = () => {
    writeFileSync(path + '.next', JSON.stringify(state), { mode: 0o600 });
    renameSync(path + '.next', path);
  };
  const flush = () => {
    send(state.pending);
    state.accepted = { ...state.pending, since: now };
    state.pending = null;
    save();
  };
  if (state.pending) flush();
  const last = state.accepted;
  if (condition === (last?.condition ?? 'ok') &&
      (condition === 'ok' || (now >= last.since && now - last.since < reminder))) return;
  state.pending = { condition, since: now };
  save();
  flush();
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--test-channel') deliver({ condition: 'test', since: Date.now() });
    else if (!args.length) notify('/var/lib/littora-astreinte', inspectCollection(), Date.now());
    else throw Error('Unexpected arguments');
  } catch {
    console.error('Collection supervision failed; verify the private state and notification channel.');
    process.exitCode = 1;
  }
}
