import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const docker = (args, timeout = 45000) => execFileSync('docker', args, {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout,
}).trim();
const name = `littora-migration-test-${randomUUID().slice(0, 8)}`;
// Small private subnets also work on development hosts with exhausted default pools.
const suffix = name.slice(-8);
const subnet = index => `10.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}.${index * 16}/28`;
const containers = [];
const networks = [];
const edge = name + '-edge';
const ingress = name + '-ingress';
const imageId = ref => docker(['image','inspect','--format','{{.Id}}',ref]);
const image = imageId(process.env.TEST_API_IMAGE || 'littora-api:ci');
const previousImage = imageId(process.env.PREVIOUS_API_IMAGE || 'littora-api:rollback-ci');
assert.notEqual(image, previousImage, 'Rollback requires two distinct API images');
const webImage = imageId(process.env.TEST_WEB_IMAGE || 'littora-web:ci');
const previousWebImage = imageId(process.env.PREVIOUS_WEB_IMAGE || 'littora-web:rollback-ci');
const postgres = `${name}-postgres`;
const redis = `${name}-redis`;
const domain = 'littora.internal';
const privacyEntrypoint = ['-v', resolve('infra/diagnostics/daemon.sh') + ':/usr/local/bin/littora-daemon:ro', '--entrypoint', '/bin/sh'];
const guard = '/usr/local/bin/littora-daemon';
function privateOutput(container) {
  const result = spawnSync('docker', ['logs', container], { encoding:'utf8', timeout:5000 });
  assert.equal(result.status, 0, 'Cannot verify disposable service output');
  return result.stdout + result.stderr;
}
const environment = ['-e', `DATABASE_URL=postgresql://littora:test-only-password@${postgres}:5432/littora_ci_test`,
  '-e', `REDIS_URL=redis://${redis}:6379/15`, '-e', 'API_PORT=3000', '-e', 'NODE_ENV=production',
  '-e', `CORS_ORIGIN=https://${domain}`];
const sql = query => docker(['exec', postgres, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', 'littora', '-d', 'littora_ci_test', '-c', query]);
const command = action => docker(['run', '--rm', '--network', name, ...environment, image, 'node', 'scripts/database.cjs', action], 180000);

// Exercise the real Compose profile/env_file path without application credentials.
const fixture = mkdtempSync(join(tmpdir(), 'littora-compose-migrations-'));
try {
  const marker = randomUUID();
  const fakeUrl = `postgresql://test:${marker}@postgres:5432/littora_ci_test`;
  const envFile = join(fixture, '.env');
  writeFileSync(envFile, `DATABASE_URL=${fakeUrl}\nPOSTGRES_VOLUME=${name}-pg\nREDIS_VOLUME=${name}-redis\nSTORAGE_VOLUMES_EXTERNAL=false\n`);
  const override = join(fixture, 'override.json');
  writeFileSync(override, JSON.stringify({ services: { migrate: { image, network_mode: 'none' } },
    networks: { default: { internal: true, ipam: { config: [{ subnet: subnet(0) }] } } } }));
  const compose = ['compose', '--project-directory', fixture, '--env-file', envFile,
    '--project-name', name, '-f', resolve('docker-compose.local.yml'), '-f', override,
    '--profile', 'tools'];
  try {
    const output = docker([...compose, 'run', '--rm', '--no-deps', '--entrypoint', 'node', 'migrate', '-e',
      `require('node:assert/strict').equal(process.env.DATABASE_URL,${JSON.stringify(fakeUrl)});console.log('Migration environment verified');`]);
    assert.equal(output, 'Migration environment verified');
  } finally { docker([...compose, 'down']); }
} finally { rmSync(fixture, { recursive: true, force: true }); }
async function until(check, description) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if (check()) return; } catch {}
    await delay(250);
  }
  throw new Error(`Timed out: ${description}`);
}
function start(service, imageName = image, extra = []) {
  const container = `${name}-${service}`;
  containers.push(container);
  // Deterministic provider outage: avoid external DNS timeouts starving database lookups.
  docker(['run', '-d', '--name', container, '--network', name,
    '--add-host', 'api.open-meteo.com:127.0.0.1', '--add-host', 'marine-api.open-meteo.com:127.0.0.1',
    ...environment, ...extra, imageName]);
  return container;
}
function request(container, path) {
  const script = `fetch(${JSON.stringify('http://127.0.0.1:3000' + path)}, {signal:AbortSignal.timeout(1500)})
    .then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()})))
    .catch(()=>process.exit(1));`;
  return JSON.parse(docker(['exec', container, 'node', '-e', script]));
}

try {
  for (const network of [name, edge, ingress]) {
    docker(['network', 'create', '--internal', '--subnet', subnet(networks.length + 1), network]);
    networks.push(network);
  }
  containers.push(postgres);
  docker(['run', '-d', '--name', postgres, '--network', name, '--platform', 'linux/amd64',
    '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_USER=littora',
    '-e', 'POSTGRES_PASSWORD=test-only-password', '-e', 'POSTGRES_DB=littora_ci_test',
    ...privacyEntrypoint, 'littora-postgres:16.16-3.7.0-r2', guard, 'postgres']);
  containers.push(redis);
  docker(['run', '-d', '--name', redis, '--network', name, '--tmpfs', '/data', ...privacyEntrypoint,
    'littora-redis:7.4.12-r1', guard, 'redis-server']);
  await until(() => docker(['exec', postgres, 'pg_isready', '-h', '127.0.0.1', '-U', 'littora']) !== '', 'PostgreSQL TCP');
  await until(() => docker(['exec', redis, 'redis-cli', 'ping']) === 'PONG', 'Redis');

  const unready = start('unmigrated');
  await until(() => docker(['inspect', '--format', '{{.State.Running}}', unready]) === 'false', 'startup refusal');
  assert.notEqual(docker(['inspect', '--format', '{{.State.ExitCode}}', unready]), '0');
  assert.ok(privateOutput(unready).includes('database_migrations_required'), 'Expected bounded migration diagnostic');
  assert.equal(sql("select to_regclass('public.schema_migrations')"), '', 'Startup must not modify the schema');

  const pending = JSON.parse(command('status')).filter(row => !row.applied).map(row => row.name);
  assert.equal(pending.at(-1), '0010_search_amenity_presence.sql');
  assert.deepEqual(JSON.parse(command('migrate')).applied, pending);
  assert.deepEqual(JSON.parse(command('migrate')).applied, []);
  assert.ok(JSON.parse(command('status')).every(row => row.applied));
  command('seed');
  const before = sql("select md5(string_agg(to_jsonb(b)::text,'' order by id)) from beaches b");
  command('seed');
  assert.equal(sql("select md5(string_agg(to_jsonb(b)::text,'' order by id)) from beaches b"), before);
  assert.equal(sql('select count(*) from water_quality'), '0');
  assert.equal(sql('select count(*) from beaches where has_parking is null and has_toilets is null and has_lifeguard is null'), '5');

  const web = `${name}-web`;
  const previousWeb = `${name}-previous-web`;
  const proxy = `${name}-proxy`;
  for (const [container, build] of [[web, webImage], [previousWeb, previousWebImage]]) {
    docker(['create','--name',container,'--network',edge,'--network-alias','web',build]);
    containers.push(container);
  }
  docker(['start', previousWeb]);
  docker(['run', '-d', '--name', proxy, '--network', edge, '--network-alias', domain,
    '-e', `DOMAIN=${domain}`, '-v', `${resolve('infra/caddy/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
    ...privacyEntrypoint, 'littora-caddy:2.11.9-r1', guard, 'caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']);
  containers.push(proxy);
  docker(['network', 'connect', ingress, proxy]);
  const peer = docker(['inspect', '--format', `{{(index .NetworkSettings.Networks "${ingress}").IPAddress}}`, proxy]);
  const reportConfig = ['-e', 'REPORT_PROXY_IPV4=' + peer, '-e', 'REPORT_IP_HASH_KEY=' + randomUUID()];
  const previous = start('previous', previousImage, reportConfig);
  const api = start('ready', image, reportConfig);
  docker(['network', 'connect', '--alias', 'api', ingress, previous]);
  await until(() => request(api, '/api/beaches?limit=1').status === 200, 'HTTP after migration');
  assert.notEqual(docker(['exec', api, 'id', '-u']), '0');
  const response = request(api, '/api/beaches/catalogue');
  assert.equal(response.status, 200);
  assert.equal(response.body.beaches.length, 5);
  assert.equal(response.body.nextCursor, null);
  const id = response.body.beaches[0].id;
  const fixtureDir = mkdtempSync(join(tmpdir(), 'littora-proxy-ca-'));
  try {
    const ca = join(fixtureDir, 'root.crt');
    await until(() => {
      docker(['cp', proxy + ':/data/caddy/pki/authorities/local/root.crt', ca]);
      return true;
    }, 'disposable TLS root');
    chmodSync(ca, 0o644);
    const visitors = [name + '-visitor-a', name + '-visitor-b'];
    for (const visitor of visitors) {
      docker(['run', '-d', '--name', visitor, '--network', edge, '--no-healthcheck',
        '-e', 'NODE_EXTRA_CA_CERTS=/tmp/test-root.crt', '-e', 'TEST_BEACH_ID=' + id,
        image, 'node', '-e', 'setInterval(()=>{},60000)']);
      containers.push(visitor);
      docker(['cp', ca, visitor + ':/tmp/test-root.crt']);
      docker(['cp', resolve('scripts/test-caddy.mjs'), visitor + ':/tmp/test-caddy.mjs']);
      docker(['cp', resolve('scripts/test-proxy-contribution.mjs'), visitor + ':/tmp/test-contribution.mjs']);
    }
    const probe = activeWeb => {
      const [digest] = docker(['exec', activeWeb, 'sha256sum', '/usr/share/nginx/html/index.html']).split(/\s+/);
      return docker(['exec','-e','TEST_INDEX_SHA256='+digest,visitors[0],'node','/tmp/test-caddy.mjs']);
    };
    const proxyReady = () => docker(['exec', visitors[0], 'node', '-e',
      `fetch('https://${domain}',{signal:AbortSignal.timeout(1500)}).then(r=>process.exit(r.ok?0:1))`]) === '';
    await until(proxyReady, 'trusted HTTPS');
    const viaProxy = () => docker(['exec', visitors[0], 'node', '-e',
      `fetch('https://${domain}/api/beaches/${id}',{signal:AbortSignal.timeout(1500)})
       .then(async r=>process.exit(r.ok && (await r.json()).id===${JSON.stringify(id)}?0:1)).catch(()=>process.exit(1))`]) === '';
    const baseline = {api:previous, web:previousWeb}, candidate = {api, web};
    const switchRelease = async (from, to) => {
      const outgoing = from.api, incoming = to.api;
      if (docker(['inspect','--format','{{.State.Running}}',incoming]) !== 'true') docker(['start',incoming]);
      await until(() => request(incoming, '/api/beaches?limit=1').status === 200, 'incoming API readiness');
      docker(['stop','--time','3',from.web]);
      docker(['network','disconnect',ingress,outgoing]);
      docker(['stop','--time','3',outgoing]);
      docker(['network','connect','--alias','api',ingress,incoming]);
      docker(['start',to.web]);
      await until(viaProxy, 'new upstream through trusted HTTPS');
      await until(proxyReady, 'frontend through trusted HTTPS');
      probe(to.web);
    };
    await until(viaProxy, 'baseline API through trusted HTTPS');
    probe(previousWeb);
    await switchRelease(baseline, candidate);
    docker(['exec', visitors[0], 'node', '/tmp/test-contribution.mjs']);
    docker(['restart', proxy]);
    await until(proxyReady, 'trusted HTTPS after restart');
    probe(web);
    docker(['exec', visitors[1], 'node', '/tmp/test-contribution.mjs']);
    assert.equal(sql('select count(distinct network_hash) from report_contributions'), '2');
    assert.equal(sql("select count(distinct split_part(key,':',2)) from report_rate_limits where key like 'session-hour:%'"), '2');
    // Equal row counts alone would not catch changed observations, authors or moderation state.
    const storedState = () => sql(`select
      (select md5(string_agg(to_jsonb(b)::text,'' order by id)) from beaches b),
      (select md5(string_agg(to_jsonb(m)::text,'' order by version)) from schema_migrations m),
      (select md5(string_agg(to_jsonb(r)::text,'' order by id)) from reports r),
      (select md5(string_agg(to_jsonb(c)::text,'' order by report_id)) from report_contributions c),
      (select md5(string_agg(to_jsonb(a)::text,'' order by id)) from report_contributors a)`);
    assert.equal(sql("select count(*) from reports where status='pending'"), '2');
    const afterWrites = storedState();
    await switchRelease(candidate, baseline);
    assert.equal(storedState(), afterWrites, 'Upgrade-time writes changed on rollback');
    docker(['exec','-e','TEST_NEXT_BEACH_ID='+response.body.beaches[1].id,visitors[0],
      'node','/tmp/test-contribution.mjs','--after-rollback']);
    assert.equal(sql("select count(*) from reports where status='pending'"), '3');
    const afterRollbackWrite = storedState();
    await switchRelease(baseline, candidate);
    assert.equal(storedState(), afterRollbackWrite, 'Rollback-time write lost returning to candidate');
    const marker = 'private-' + randomUUID();
    const probePrivacy = (path, method, expected) => docker(['exec', visitors[0], 'node', '-e',
      `const marker=${JSON.stringify(marker)};
       fetch(${JSON.stringify('https://' + domain + path)} + '?lat=43.987654321&lon=6.123456789&q=' + marker, {method:${JSON.stringify(method)},
         headers:{authorization:'Bearer '+marker,cookie:'id='+marker,'user-agent':marker,'x-request-id':marker,'content-type':'application/json'},
         body:${method === 'POST' ? 'JSON.stringify({message:marker})' : 'undefined'}})
         .then(r=>{if(r.status!==${expected}) process.exit(1); console.log(r.headers.get('x-request-id') || 'none')})`]);
    probePrivacy('/recherche', 'GET', 200);
    probePrivacy('/api/reports', 'POST', 400);
    const requestId = probePrivacy('/api/admin/health', 'GET', 503);
    assert.match(requestId, /^[a-f0-9-]{36}$/);
    const dbError = spawnSync('docker',['exec',postgres,'psql','-U','littora','-d','littora_ci_test','-c',`select '${marker}'::integer`],{stdio:'ignore'});
    assert.equal(dbError.status,1);
    assert.equal(docker(['exec',redis,'redis-cli','CONFIG','GET','slowlog-log-slower-than']), 'slowlog-log-slower-than\n-1');
    assert.equal(docker(['exec',redis,'redis-cli','CONFIG','GET','acllog-max-len']), 'acllog-max-len\n0');
    docker(['stop', web]);
    probePrivacy('/recherche', 'GET', 502);
    const visitorAddress = docker(['inspect','--format',`{{(index .NetworkSettings.Networks "${edge}").IPAddress}}`,visitors[0]]);
    assert.ok(visitorAddress.startsWith('10.'));
    for (const [container, signal] of [[api,requestId],[postgres,'database_error'],[redis,'redis_ready'],[web,'web_response'],[proxy,'proxy_warning']]) {
      await until(() => privateOutput(container).includes(signal), 'safe diagnostic');
      const captured = privateOutput(container);
      assert.ok([marker,visitorAddress,'43.987654321','6.123456789'].every(value => !captured.includes(value)), 'Private fixture appeared in service output');
    }
  } finally { rmSync(fixtureDir, { recursive: true, force: true }); }
  assert.equal(request(api, `/api/beaches/${id}`).body.id, id);
  assert.deepEqual(request(api, `/api/reports?beachId=${id}`).body, []);
  const score = request(api, `/api/score/beach/${id}`);
  assert.equal(score.status, 200, JSON.stringify(score.body));
  assert.equal(score.body.safety.officialFlag.value, null);
  assert.equal(score.body.safety.calculatedConditions.level, 'unknown');
  assert.ok(Object.values(score.body.scores).every(value => value === null));
  for (const group of ['weather', 'marine']) {
    const values = Object.values(score.body.measurements[group]);
    assert.ok(values.length > 0);
    assert.ok(values.every(value => value.value === null && value.status === 'unknown'));
  }
  assert.equal(sql("select md5(string_agg(to_jsonb(b)::text,'' order by id)) from beaches b"), before);

  console.log(JSON.stringify({ verified: true, readonlyStartup: true, migrations: pending.length, verifiedHttps: true,
    seedIdempotent: true, beaches: 5, sanitarySamples: 0, http: true, offlineScoreContract: true,
    verifiedApplicationRollback: true, pendingReportsPreserved: 3 }));
} finally {
  const failures = [];
  for (const container of containers.reverse()) {
    try { docker(['rm', '-f', '-v', container]); } catch { failures.push(container); }
  }
  for (const network of networks.reverse()) {
    try { docker(['network', 'rm', network]); } catch { failures.push(network); }
  }
  if (failures.length) throw new Error(`Test cleanup incomplete: ${failures.join(', ')}`);
}
