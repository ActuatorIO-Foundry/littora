import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('install policy: every locked lifecycle script has an exact reviewed decision', () => {
  {
    const dir = root;
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json')));
    const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json')));
    assert.match(readFileSync(join(dir, '.npmrc'), 'utf8'), /^strict-allow-scripts=true$/m);
    const decisions = new Set();
    for (const [path, dependency] of Object.entries(lock.packages)) {
      if (!dependency.hasInstallScript) continue;
      const name = path.split('node_modules/').at(-1);
      const key = `${name}@${dependency.version}`;
      assert.equal(typeof pkg.allowScripts[key], 'boolean', `review ${key}`);
      decisions.add(key);
    }
    assert.deepEqual(new Set(Object.keys(pkg.allowScripts)), decisions, 'No stale or wildcard approvals');
  }
});

test('npm ci: unknown scripts fail closed, denied scripts skip, approved scripts run', { timeout: 60000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'littora-install-policy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fixture = join(dir, 'fixture');
  const project = join(dir, 'project');
  mkdirSync(fixture); mkdirSync(project);
  const npm = process.env.npm_execpath;
  assert.ok(npm, 'Run through npm run test:ops');
  const marker = join(dir, 'script-ran');
  const env = { ...process.env, POLICY_MARKER: marker, npm_config_cache: join(dir, 'cache'), npm_config_ignore_scripts: 'false', npm_config_dangerously_allow_all_scripts: 'false' };
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'policy-fixture', version: '1.0.0', scripts: { postinstall: 'node install.cjs' } }));
  writeFileSync(join(fixture, 'install.cjs'), "require('node:fs').writeFileSync(process.env.POLICY_MARKER, 'executed');\n");
  execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--offline', '--pack-destination', dir], { cwd: fixture, env, stdio: 'pipe' });
  const tarball = readFileSync(join(dir, 'policy-fixture-1.0.0.tgz'));
  let registry;
  const server = createServer((request, response) => {
    if (request.url === '/policy-fixture/-/policy-fixture-1.0.0.tgz') return response.end(tarball);
    if (request.url !== '/policy-fixture') { response.statusCode = 404; return response.end(); }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ name: 'policy-fixture', 'dist-tags': { latest: '1.0.0' }, versions: {
      '1.0.0': { name: 'policy-fixture', version: '1.0.0', scripts: { postinstall: 'node install.cjs' }, dist: {
        tarball: `${registry}/policy-fixture/-/policy-fixture-1.0.0.tgz`,
        integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
      } },
    } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  registry = `http://127.0.0.1:${server.address().port}`;
  const pkg = { name: 'policy-test', version: '1.0.0', private: true, dependencies: { 'policy-fixture': '1.0.0' } };
  const manifest = join(project, 'package.json');
  writeFileSync(manifest, JSON.stringify(pkg));
  writeFileSync(join(project, '.npmrc'), `strict-allow-scripts=true\nregistry=${registry}\n`);
  const run = promisify(execFile);
  await run(process.execPath, [npm, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: project, env });
  const policyKey = 'policy-fixture@1.0.0';
  const install = async () => {
    try { return { status: 0, ...await run(process.execPath, [npm, 'ci', '--no-audit', '--no-fund'], { cwd: project, env }) }; }
    catch (error) { return { status: error.code, stderr: error.stderr }; }
  };
  const unknown = await install();
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /EALLOWSCRIPTS|allowScripts|unreviewed/i);
  assert.equal(existsSync(marker), false);
  writeFileSync(manifest, JSON.stringify({ ...pkg, allowScripts: { [policyKey]: false } }));
  const denied = await install();
  assert.equal(denied.status, 0, denied.stderr);
  assert.equal(existsSync(marker), false);
  writeFileSync(manifest, JSON.stringify({ ...pkg, allowScripts: { [policyKey]: true } }));
  const approved = await install();
  assert.equal(approved.status, 0, approved.stderr);
  assert.equal(readFileSync(marker, 'utf8'), 'executed');
});
