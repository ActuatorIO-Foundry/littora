import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dockerEnvironment, validateProduction } from './production-config.mjs';

const exceptions = JSON.parse(readFileSync(new URL('../infra/security-exceptions.json', import.meta.url), 'utf8'));
const npmExceptions = JSON.parse(readFileSync(new URL('../infra/npm-security-exceptions.json', import.meta.url), 'utf8'));
const releaseHolds = JSON.parse(readFileSync(new URL('../infra/release-holds.json', import.meta.url), 'utf8'));
const checkOnly = process.argv.length === 3 && process.argv[2] === '--check';
if (process.argv.length > 2 && !checkOnly) {
  console.error('Usage: node scripts/start-production.mjs [--check]');
  process.exit(1);
}
if (!checkOnly && (exceptions.length || npmExceptions.length)) {
  const tickets = [...new Set([...exceptions, ...npmExceptions].map(entry => entry.issue))];
  console.error('Production blocked: resolve security exceptions before deployment:', tickets.join(', '));
  process.exit(1);
}
if (!checkOnly && releaseHolds.length) {
  console.error('Production blocked: release approval pending:', releaseHolds.join(', '));
  process.exit(1);
}
const args = ['compose', '--env-file', '.env.prod', '--project-name', 'littora-prod', '-f', 'docker-compose.prod.yml'];
const env = dockerEnvironment();
const result = spawnSync('docker', [...args, '--profile', 'tools', 'config', '--format', 'json'], { env, encoding: 'utf8' });
if (result.status !== 0) {
  console.error('Invalid production configuration: check .env.prod, DOMAIN, POSTGRES_USER, POSTGRES_DB and POSTGRES_PASSWORD, and Docker Compose availability.');
  process.exit(1);
}
try { validateProduction(JSON.parse(result.stdout)); }
catch (error) { console.error(error instanceof SyntaxError ? 'Invalid Compose response' : error.message); process.exit(1); }
if (checkOnly) {
  console.log('Configuration verified. No deployment performed.');
  process.exit(0);
}
const child = spawnSync('docker', [...args, 'up', '--build', '-d', '--wait'], { env, stdio: 'inherit' });
process.exit(child.status ?? 1);
