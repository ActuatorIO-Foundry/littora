import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const name = `littora-proxy-test-${randomUUID().slice(0, 8)}`;
const containers = [];
const runtime = process.env.TEST_API_IMAGE || 'littora-api:ci';
docker(['network', 'create', '--internal', name]);
try {
  for (const [service, port] of [['api', 3000], ['web', 80]]) {
    const container = `${name}-${service}`;
    docker(['run', '-d', '--name', container, '--network', name, '--network-alias', service,
      runtime, 'node', '-e', `require('http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end(JSON.stringify({service:'${service}',path:q.url}))}).listen(${port},'0.0.0.0')`]);
    containers.push(container);
  }
  const caddy = `${name}-caddy`;
  docker(['run', '-d', '--name', caddy, '--network', name,
    '-v', `${resolve('infra/caddy/Caddyfile')}:/etc/caddy/Caddyfile:ro`, 'littora-caddy:2.11.9-r1']);
  containers.push(caddy);
  docker(['exec', caddy, 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile']);
  const request = (path) => JSON.parse(docker(['exec', `${name}-api`, 'node', '-e',
    `fetch(${JSON.stringify(`http://${caddy}`)}+${JSON.stringify(path)},{signal:AbortSignal.timeout(5000)}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()})))`]));
  for (let i = 0; i < 40; i++) {
    try { if (request('/').status === 200) break; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  for (const [path, service] of [['/', 'web'], ['/recherche', 'web'], ['/plages/test', 'web'], ['/api', 'api'], ['/api/beaches?limit=1', 'api']]) {
    const response = request(path);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { service, path });
  }
  console.log('Caddy validated: API prefix, query parameters and frontend routes preserved.');
} finally {
  for (const container of containers.reverse()) docker(['rm', '-f', container]);
  docker(['network', 'rm', name]);
}
