import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const exceptions = JSON.parse(readFileSync(new URL('../infra/security-exceptions.json', import.meta.url), 'utf8'));
const npmExceptions = JSON.parse(readFileSync(new URL('../infra/npm-security-exceptions.json', import.meta.url), 'utf8'));
if (exceptions.length || npmExceptions.length) {
  const tickets = [...new Set([...exceptions, ...npmExceptions].map(entry => entry.issue))];
  console.error('Production blocked: resolve security exceptions before deployment:', tickets.join(', '));
  process.exit(1);
}
const child = spawnSync('docker', ['compose', '--env-file', '.env.prod', '--project-name', 'littora-prod',
  '-f', 'docker-compose.prod.yml', 'up', '--build', '-d'], { stdio: 'inherit' });
process.exit(child.status ?? 1);
