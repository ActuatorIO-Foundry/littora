require('reflect-metadata');
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { randomBytes } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { AdminModule } = require('../dist/modules/admin/admin.module');
const { IngestionController } = require('../dist/modules/ingestion/ingestion.controller');
const { IngestionService } = require('../dist/modules/ingestion/ingestion.service');
const { BeachesController } = require('../dist/modules/beaches/beaches.controller');
const { BeachesService } = require('../dist/modules/beaches/beaches.service');
const { beach } = require('./fixtures.cjs');

let app, url, calls = 0;
const token = randomBytes(32).toString('hex');
const originalToken = process.env.ADMIN_API_TOKEN;

before(async () => {
  const module = await Test.createTestingModule({
    imports: [AdminModule],
    controllers: [IngestionController, BeachesController],
    providers: [
      { provide: IngestionService, useValue: { waterQuality: async () => {
        calls += 1;
        return { queued: true };
      } } },
      { provide: BeachesService, useValue: { list: async () => [beach] } },
    ],
  }).compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});

after(async () => {
  if (originalToken === undefined) delete process.env.ADMIN_API_TOKEN;
  else process.env.ADMIN_API_TOKEN = originalToken;
  await app?.close();
});

test('HTTP: public catalogue remains accessible without a token', async () => {
  delete process.env.ADMIN_API_TOKEN;
  const response = await fetch(`${url}/api/beaches`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [beach]);
});

test('HTTP: internal routes fail closed without a valid configured secret', async () => {
  for (const secret of ['', 'short', ' '.repeat(32)]) {
    process.env.ADMIN_API_TOKEN = secret;
    const response = await fetch(`${url}/api/ingestion/water-quality`, { method: 'POST' });
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
    assert.equal((await fetch(`${url}/api/admin/health`)).status, 503);
  }
});

test('HTTP: missing, wrong and malformed credentials cannot enqueue a job', async () => {
  process.env.ADMIN_API_TOKEN = token;
  for (const authorization of ['', `Basic ${token}`, `Bearer ${'x'.repeat(64)}`, 'Bearer short']) {
    const response = await fetch(`${url}/api/ingestion/water-quality`, {
      method: 'POST', headers: { authorization },
    });
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
    assert.equal((await fetch(`${url}/api/admin/health`, { headers: { authorization } })).status, 401);
  }
});

test('HTTP: valid internal token permits the operation and is not returned', async () => {
  process.env.ADMIN_API_TOKEN = token;
  const headers = { authorization: `Bearer ${token}` };
  const response = await fetch(`${url}/api/ingestion/water-quality`, { method: 'POST', headers });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { queued: true });
  assert.equal(calls, 1);
  const health = await fetch(`${url}/api/admin/health`, { headers });
  assert.equal(health.status, 200);
  assert.ok(!(await health.text()).includes(token));
});
