import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const nodeVersion = readFileSync(new URL('.nvmrc', root), 'utf8').trim();
const manifest = readJson('package.json');
const npmVersion = manifest.packageManager.split('@')[1];

assert.equal(process.versions.node, nodeVersion, 'Use the Node version in .nvmrc');
assert.ok(
  process.env.npm_config_user_agent?.startsWith(`npm/${npmVersion} `),
  `Run npm run check:toolchain with npm ${npmVersion}`,
);

const lock = readJson('package-lock.json');
assert.deepEqual(manifest.workspaces, ['apps/api', 'apps/web', 'packages/api-client']);
for (const directory of ['', ...manifest.workspaces]) {
  const pkg = directory ? readJson(`${directory}/package.json`) : manifest;
  if (directory) assert.equal(existsSync(new URL(`${directory}/package-lock.json`, root)), false, 'Use the root lockfile');
  assert.equal(pkg.packageManager, manifest.packageManager);
  assert.deepEqual(pkg.engines, manifest.engines);
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    assert.deepEqual(lock.packages[directory][section], pkg[section], `${directory}: lockfile mismatch`);
    for (const [name, version] of Object.entries(pkg[section] ?? {})) {
      assert.match(version, /^\d+\.\d+\.\d+$/, `${directory}: pin ${name} exactly`);
      const dependency = lock.packages[`${directory}/node_modules/${name}`] ?? lock.packages[`node_modules/${name}`];
      assert.equal(dependency?.link ? lock.packages[dependency.resolved]?.version : dependency?.version, version, name);
    }
  }
  if (!['apps/api', 'apps/web'].includes(directory)) continue;
  const dockerfiles = directory === 'apps/api' ? ['Dockerfile'] : ['Dockerfile.local', 'Dockerfile.prod'];
  for (const dockerfile of dockerfiles) {
    const content = readFileSync(new URL(`${directory}/${dockerfile}`, root), 'utf8');
    const versions = [...content.matchAll(/^FROM node:([^\s]+)/gm)].map((match) => match[1]);
    assert.ok(versions.length && versions.every((version) =>
      version.startsWith(`${nodeVersion}-alpine@sha256:`) && /@sha256:[a-f0-9]{64}$/.test(version),
    ));
    assert.ok(content.includes('npm ci'), `${dockerfile}: use npm ci`);
    assert.ok(!content.includes('npm install'), `${dockerfile}: non-reproducible installation`);
  }
}
console.log('Node/npm, direct dependencies, lockfiles and Docker builds are aligned.');
