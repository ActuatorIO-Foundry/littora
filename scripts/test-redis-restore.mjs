import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const Redis = require('ioredis');
const { Queue, Worker } = require('bullmq');
const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const source = process.env.REDIS_CONTAINER;
assert.ok(source, 'REDIS_CONTAINER must identify the disposable Compose test service');
const metadata = JSON.parse(docker(['inspect', source]))[0];
assert.match(metadata.Config.Labels['com.docker.compose.project'], /^littora-tests(?:-[a-z0-9-]+)?$/);
assert.equal(metadata.Config.Labels['com.docker.compose.service'], 'redis');
const url = process.env.TEST_REDIS_URL;
const sourceUrl = new URL(url);
assert.equal(sourceUrl.pathname, '/15');
assert.ok(['127.0.0.1','localhost'].includes(sourceUrl.hostname));
assert.ok(metadata.NetworkSettings.Ports['6379/tcp'].some(p=>p.HostIp==='127.0.0.1' && p.HostPort===sourceUrl.port));
const connection = new Redis(url, { maxRetriesPerRequest: null });
const name = `restore-${randomUUID()}`;
const queue = new Queue(name, { connection });
const directory = mkdtempSync(join(tmpdir(), 'littora-redis-'));
let restored, targetConnection, targetQueue, worker;
try {
  await queue.pause();
  await queue.add('weather', { beach: 'fixture', preserved: true }, { jobId: 'waiting' });
  await queue.add('weather', { beach: 'later' }, { jobId: 'job-delayed', delay: 600000 });
  await connection.set(`${name}:cache`, 'original', 'PX', 600000);
  const expiration = await connection.pexpiretime(`${name}:cache`);
  docker(['exec', source, 'redis-cli', 'SAVE']);
  docker(['cp', `${source}:/data/dump.rdb`, join(directory, 'dump.rdb')]);
  restored = `littora-${name}`;
  docker(['create', '--name', restored, '-p', '127.0.0.1::6379', 'littora-redis:7.4.12-r2']);
  docker(['cp', join(directory, 'dump.rdb'), `${restored}:/data/dump.rdb`]);
  docker(['start', restored]);
  const port = JSON.parse(docker(['inspect', restored]))[0].NetworkSettings.Ports['6379/tcp'][0].HostPort;
  targetConnection = new Redis(`redis://127.0.0.1:${port}/15`, { maxRetriesPerRequest: null });
  targetQueue = new Queue(name, { connection: targetConnection });
  assert.equal(await targetConnection.get(`${name}:cache`), 'original');
  assert.equal(await targetConnection.pexpiretime(`${name}:cache`), expiration);
  assert.equal(await targetQueue.isPaused(), true);
  const waiting = await targetQueue.getJob('waiting');
  assert.deepEqual(waiting.data, { beach: 'fixture', preserved: true });
  assert.equal(await (await targetQueue.getJob('job-delayed')).getState(), 'delayed');
  const completed = new Promise((resolve, reject) => {
    worker = new Worker(name, async job => job.data, { connection: targetConnection });
    worker.once('completed', resolve);
    worker.once('error', reject);
  });
  await targetQueue.resume();
  const timeout = setTimeout(() => worker.emit('error', new Error('Restored queue timeout')), 10000);
  try { await completed; } finally { clearTimeout(timeout); }
  assert.equal(await waiting.getState(), 'completed');
  console.log('Redis RDB restore verified: TTL, delayed/paused jobs, payload and resumed worker.');
} finally {
  await worker?.close();
  await targetQueue?.close();
  targetConnection?.disconnect();
  try {
    await queue.obliterate({ force: true });
    await connection.del(`${name}:cache`);
  } finally {
    await queue.close();
    connection.disconnect();
    if (restored) docker(['rm', '-fv', restored]);
    rmSync(directory, { recursive: true, force: true });
  }
}
