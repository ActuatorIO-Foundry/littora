import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dockerEnvironment, validateProduction } from '../production-config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'littora-prod-config-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const password = randomBytes(32).toString('hex');
  const template = readFileSync(join(root, '.env.prod.example'), 'utf8');
  copyFileSync(join(root, 'docker-compose.prod.yml'), join(cwd, 'docker-compose.prod.yml'));
  const configure = (domain, key = password) => writeFileSync(join(cwd, '.env.prod'),
    template.replace(/^DOMAIN=$/m, 'DOMAIN=' + domain).replace(/^POSTGRES_PASSWORD=$/m, 'POSTGRES_PASSWORD=' + key));
  return { cwd, password, configure };
}
test('production model: private services, shared job queue, one HTTPS origin and readiness', t => {
  const { cwd, configure } = fixture(t);
  configure('plages.exemple.fr');
  const model = JSON.parse(execFileSync('docker', ['compose', '--env-file', '.env.prod', '--project-name', 'littora-prod',
    '-f', 'docker-compose.prod.yml', '--profile', 'tools', 'config', '--format', 'json'], { cwd, env: dockerEnvironment() }));
  validateProduction(model);
  const { services } = model;
  for (const name of ['postgres','redis','redis-jobs','caddy']) {
    const executable = '/usr/local/bin/littora-daemon';
    assert.deepEqual(services[name].entrypoint, ['/bin/sh', executable]);
    assert.ok(services[name].volumes.some(v => v.type === 'bind' && v.target === executable && v.read_only &&
      v.source.endsWith('/infra/diagnostics/daemon.sh')), name);
  }
  for (const [name, service] of Object.entries(services)) {
    if (name !== 'caddy') assert.equal(service.ports, undefined, name);
  }
  assert.deepEqual(services.caddy.ports.map(p => Number(p.published)).sort((a,b) => a-b), [80,443]);
  assert.equal(services.api.environment.CORS_ORIGIN, 'https://plages.exemple.fr');
  assert.equal(model.networks.proxy_api.internal, true);
  assert.deepEqual(Object.keys(services.caddy.networks).sort(), ['edge','proxy_api']);
  assert.deepEqual(Object.keys(services.api.networks).sort(), ['default','proxy_api']);
  assert.deepEqual(Object.keys(services.web.networks), ['edge']);
  assert.deepEqual(Object.keys(services).filter(s => Object.hasOwn(services[s].networks ?? {}, 'proxy_api')).sort(), ['api','caddy']);
  const invalidPeer = structuredClone(model);
  invalidPeer.services.api.environment.REPORT_PROXY_IPV4 = '10.0.0.0/8';
  assert.throws(() => validateProduction(invalidPeer), /REPORT_PROXY_IPV4/);
  const exposed = structuredClone(model);
  exposed.services.api.ports = [{published: '3000', target: 3000}];
  assert.throws(() => validateProduction(exposed), /proxy_api/);
  delete exposed.services.api.ports;
  exposed.services.worker.networks.proxy_api = null;
  assert.throws(() => validateProduction(exposed), /proxy_api/);
  assert.equal(services.api.environment.JOBS_REDIS_URL, services.worker.environment.JOBS_REDIS_URL);
  assert.notEqual(services.api.environment.JOBS_REDIS_URL, services.api.environment.REDIS_URL);
  for (const service of ['api','worker']) {
    for (const dependency of ['postgres','redis','redis-jobs'])
      assert.equal(services[service].depends_on[dependency].condition, 'service_healthy');
  }
  for (const dependency of ['api','web']) assert.equal(services.caddy.depends_on[dependency].condition, 'service_healthy');
  services.worker.environment.DATABASE_URL = 'postgresql://wrong.invalid';
  assert.throws(() => validateProduction(model), /DATABASE_URL/);
});
test('production preflight: no deployment, no local overrides and no secrets in diagnostics', t => {
  const { cwd, password, configure } = fixture(t);
  const check = () => spawnSync(process.execPath, [join(root, 'scripts/start-production.mjs'), '--check'], {
    cwd, encoding: 'utf8', env: { ...process.env, DOMAIN: ':80', POSTGRES_PASSWORD: 'local-only' },
  });
  for (const domain of ['', ':80', 'localhost', 'api.localhost', 'https://plages.fr', 'plages.fr:443', 'plages.fr/path']) {
    configure(domain);
    const result = check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DOMAIN/);
    assert.ok(!(result.stderr + result.stdout).includes(password));
  }
  configure('plages.exemple.fr', 'too-short');
  assert.match(check().stderr, /POSTGRES_PASSWORD/);
  configure('plages.exemple.fr');
  const valid = check();
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /No deployment/);
  assert.ok(!(valid.stderr + valid.stdout).includes(password));
});
