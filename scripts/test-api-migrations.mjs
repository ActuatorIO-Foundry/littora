import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const docker = args => execFileSync('docker', args, {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000,
}).trim();
const name = `littora-migration-test-${randomUUID().slice(0, 8)}`;
const containers = [];
const image = process.env.TEST_API_IMAGE || 'littora-api:ci';
const postgres = `${name}-postgres`;
const redis = `${name}-redis`;
const environment = ['-e', `DATABASE_URL=postgresql://littora:test-only-password@${postgres}:5432/littora_ci_test`,
  '-e', `REDIS_URL=redis://${redis}:6379/15`, '-e', 'API_PORT=3000', '-e', 'NODE_ENV=production'];
const sql = query => docker(['exec', postgres, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', 'littora', '-d', 'littora_ci_test', '-c', query]);
const command = action => docker(['run', '--rm', '--network', name, ...environment, image, 'node', 'scripts/database.cjs', action]);
async function until(check, description) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if (check()) return; } catch {}
    await delay(250);
  }
  throw new Error(`Timed out: ${description}`);
}
function start(service, imageName = image) {
  const container = `${name}-${service}`;
  containers.push(container);
  docker(['run', '-d', '--name', container, '--network', name, ...environment, imageName]);
  return container;
}
function request(container, path) {
  const script = `fetch(${JSON.stringify('http://127.0.0.1:3000' + path)}, {signal:AbortSignal.timeout(1500)})
    .then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()})))
    .catch(()=>process.exit(1));`;
  return JSON.parse(docker(['exec', container, 'node', '-e', script]));
}

docker(['network', 'create', '--internal', name]);
try {
  containers.push(postgres);
  docker(['run', '-d', '--name', postgres, '--network', name, '--platform', 'linux/amd64',
    '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_USER=littora',
    '-e', 'POSTGRES_PASSWORD=test-only-password', '-e', 'POSTGRES_DB=littora_ci_test',
    'littora-postgres:16.16-3.7.0-r1']);
  containers.push(redis);
  docker(['run', '-d', '--name', redis, '--network', name, '--tmpfs', '/data', 'littora-redis:7.4.12-r1']);
  await until(() => docker(['exec', postgres, 'pg_isready', '-h', '127.0.0.1', '-U', 'littora']) !== '', 'PostgreSQL TCP');
  await until(() => docker(['exec', redis, 'redis-cli', 'ping']) === 'PONG', 'Redis');

  const unready = start('unmigrated');
  await until(() => docker(['inspect', '--format', '{{.State.Running}}', unready]) === 'false', 'startup refusal');
  assert.notEqual(docker(['inspect', '--format', '{{.State.ExitCode}}', unready]), '0');
  const logs = spawnSync('docker', ['logs', unready], { encoding: 'utf8', timeout: 5000 });
  assert.match(logs.stdout + logs.stderr, /Database migrations required/);
  assert.equal(sql("select to_regclass('public.schema_migrations')"), '', 'Startup must not modify the schema');

  assert.equal(JSON.parse(command('status')).filter(row => !row.applied).length, 2);
  assert.equal(JSON.parse(command('migrate')).applied.length, 2);
  assert.deepEqual(JSON.parse(command('migrate')).applied, []);
  assert.ok(JSON.parse(command('status')).every(row => row.applied));
  command('seed');
  const before = sql("select md5(string_agg(to_jsonb(b)::text,'' order by id)) from beaches b");
  command('seed');
  assert.equal(sql("select md5(string_agg(to_jsonb(b)::text,'' order by id)) from beaches b"), before);
  assert.equal(sql('select count(*) from water_quality'), '0');
  assert.equal(sql('select count(*) from beaches where has_parking is null and has_toilets is null and has_lifeguard is null'), '5');

  const api = start('ready');
  await until(() => request(api, '/api/beaches?limit=1').status === 200, 'HTTP after migration');
  assert.notEqual(docker(['exec', api, 'id', '-u']), '0');
  const response = request(api, '/api/beaches/catalogue');
  assert.equal(response.status, 200);
  assert.equal(response.body.beaches.length, 5);
  assert.equal(response.body.nextCursor, null);
  const id = response.body.beaches[0].id;
  assert.equal(request(api, `/api/beaches/${id}`).body.id, id);
  assert.deepEqual(request(api, `/api/reports?beachId=${id}`).body, []);
  assert.equal(sql("select md5(string_agg(to_jsonb(b)::text,'' order by id)) from beaches b"), before);

  if (process.env.PREVIOUS_API_IMAGE) {
    const previous = start('previous', process.env.PREVIOUS_API_IMAGE);
    await until(() => request(previous, '/api/beaches?limit=1').status === 200, 'previous API compatibility');
    assert.equal(request(previous, `/api/beaches/${id}`).body.id, id);
  }
  console.log(JSON.stringify({ verified: true, readonlyStartup: true, migrations: 2,
    seedIdempotent: true, beaches: 5, sanitarySamples: 0, http: true,
    previousImage: Boolean(process.env.PREVIOUS_API_IMAGE) }));
} finally {
  const failures = [];
  for (const container of containers.reverse()) {
    try { docker(['rm', '-f', '-v', container]); } catch { failures.push(container); }
  }
  try { docker(['network', 'rm', name]); } catch { failures.push(name); }
  if (failures.length) throw new Error(`Test cleanup incomplete: ${failures.join(', ')}`);
}
