import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { localPorts } from '../local-config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'littora-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('local ports: defaults work without a .env file', (t) => {
  assert.deepEqual(localPorts({}, join(fixture(t), 'absent')), { API_PORT: '3000', WEB_PORT: '4200' });
});

test('local ports: environment overrides parsed .env values', (t) => {
  const path = join(fixture(t), '.env');
  writeFileSync(path, 'API_PORT="3001" # alternate API\nWEB_PORT=4202\nJWT_SECRET=not-forwarded\n');
  assert.deepEqual(localPorts({ WEB_PORT: '4201' }, path), { API_PORT: '3001', WEB_PORT: '4201' });
});

test('local ports: malformed or unavailable port numbers fail explicitly', (t) => {
  const path = join(fixture(t), 'absent');
  for (const value of ['0', '65536', '-1', '3.5', 'abc', '', '3000/api']) {
    assert.throws(() => localPorts({ API_PORT: value }, path), /API_PORT/);
  }
});

test('native proxy: API port is configurable and malformed values are rejected', () => {
  const path = join(root, 'apps/web/proxy.local.cjs');
  const result = execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require(process.argv[1])))', path], {
    encoding: 'utf8', env: { ...process.env, API_PORT: '3001' },
  });
  assert.equal(JSON.parse(result)['/api'].target, 'http://127.0.0.1:3001');
  assert.throws(() => execFileSync(process.execPath, [path], {
    env: { ...process.env, API_PORT: 'not-a-port' }, stdio: 'pipe',
  }));
});

test('Compose: alternate loopback ports preserve internal ports and the data volume', (t) => {
  const dir = fixture(t);
  const envFile = join(dir, '.env');
  writeFileSync(envFile, readFileSync(join(root, '.env.example')));
  const args = [
    'compose', '--project-directory', dir, '--env-file', envFile,
    '-f', join(root, 'docker-compose.local.yml'), 'config', '--format', 'json',
  ];
  const options = {
    encoding: 'utf8', env: { ...process.env, API_PORT: '3001', WEB_PORT: '4201', POSTGRES_PORT: '15432', REDIS_PORT: '16379' },
    stdio: 'pipe',
  };
  const result = execFileSync('docker', args, options);
  const config = JSON.parse(result);
  for (const [service, published, target] of [['api', '3001', 3000], ['web', '4201', 4200], ['postgres', '15432', 5432], ['redis', '16379', 6379]]) {
    const port = config.services[service].ports[0];
    assert.equal(port.host_ip, '127.0.0.1', service);
    assert.equal(String(port.published), published, service);
    assert.equal(port.target, target, service);
  }
  assert.equal(String(config.services.api.environment.API_PORT), '3000');
  assert.ok(config.services.postgres.volumes.some(v => v.source === 'pgdata' && v.target === '/var/lib/postgresql/data'));
  assert.ok(!config.services.postgres.volumes.some(v => v.target.startsWith('/docker-entrypoint-initdb.d')));
  assert.equal(config.services.migrate, undefined, 'Migrations are excluded from ordinary startup');
  const withTools = JSON.parse(execFileSync('docker', ['compose', '--profile', 'tools', ...args.slice(1)], options));
  assert.deepEqual(withTools.services.migrate.profiles, ['tools']);
  assert.deepEqual(withTools.services.migrate.command, ['node', 'scripts/database.cjs', 'migrate']);
  assert.equal(config.services.api.depends_on.postgres.condition, 'service_healthy');
  assert.equal(config.services.api.depends_on.migrate, undefined, 'Migration requires an explicit operation');
});
