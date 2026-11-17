require('reflect-metadata');
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { Test } = require('@nestjs/testing');
const { PATH_METADATA, METHOD_METADATA } = require('@nestjs/common/constants');
const { RequestMethod } = require('@nestjs/common');
const { contract, operations, schemaValidator, responseValidator } = require('../dist/http/contract');
const { configureHttpBoundary } = require('../dist/http/http-boundary');
const { presentForecast, presentScore, presentBeach, presentReport } = require('../dist/http/presenters');
const { beach } = require('./fixtures.cjs');
const examples = require('../../../contracts/examples/measurements.json');
const id = beach.id;
const now = '2026-07-15T12:00:00.000Z';
const forecast = { provider: 'open-meteo', kind: 'forecast', status: 'partial', fetchedAt: now,
  validAt: now, producedAt: null, ageSeconds: 0, units: { wind_speed_10m: 'km/h', uv_index: 'index' },
  current: { time: now, wind_speed_10m: 0, uv_index: null } };
const tides = { provider: 'shom', status: 'unknown', reliability: 'unknown', fetchedAt: null,
  validAt: null, ageSeconds: null, harbor: null, events: [], warning: 'Not connected' };
const water = { provider: 'unknown', status: 'unknown', classification: null };
const row = { ...beach, waterType: 'sea', distanceKm: null };
const report = { id, beach_id: id, type: 'flag', value: { flag: 'green' }, confidence: '0.7', status: 'pending', created_at: new Date(now) };
const commune = { code: '83009', name: 'Bandol', center: { lat: 43.13, lon: 5.75 },
  department: { code: '83', name: 'Var' }, region: { code: '93', name: 'PACA' }, bbox: [43, 5, 44, 6],
  contour: { type: 'Polygon', coordinates: [[[5,43],[6,43],[6,44],[5,43]]] } };
const score = { beach: row, current: { weather: forecast.current, marine: forecast.current, tides, waterQuality: water, community: [] },
  scores: { bathing: null, family: null, paddle: null, boat: null },
  safety: { flag: 'red', estimatedFlag: 'green', source: 'legacy', official: false, alerts: [],
    communityFlag: { flag: 'red', confidence: 1, counts: { red: 1, green: 0, yellow: 0 }, history: [{ flag: 'red', confidence: 1, time: now }] } },
  summary: {}, forecast: { uv: [{ time: now, value: 0 }] }, reliability: {},
  dataStatus: { weather: forecast, marine: forecast }, providers: { weather: 'open-meteo' }, disclaimer: 'Indicative' };
let app, url, calls = 0, fail = false, corrupt = false, receivedReport;
const modules = [
  ['beaches', 'Beaches', { list: async () => { calls++; if (fail) throw new Error('SQL password=secret'); return [{ ...row, lat: corrupt ? 'bad' : row.lat }]; },
    get: async () => row, catalogue: async () => ({ beaches: [row], nextCursor: null }),
    nearbyAmenities: async () => ({ beachId: id, provider: 'openstreetmap', radiusMeters: 1800, amenities: [] }),
    discoverFromOpenStreetMap: async () => ({ provider: 'openstreetmap', imported: 0, beaches: [row] }) }],
  ['places', 'Places', { search: async () => [commune], catalogue: async () => ({ commune, beaches: [row], source: 'local-catalogue', collectedAt: null, coverage: 'partial', capped: false }) }],
  ['weather', 'Weather', { get: async () => forecast }], ['marine', 'Marine', { get: async () => forecast }],
  ['tides', 'Tides', { get: async () => tides }], ['water-quality', 'WaterQuality', { get: async () => water }],
  ['alerts', 'Alerts', { get: async () => ({ provider: 'meteofrance-ready', alerts: [], warning: 'Not connected' }) }],
  ['score', 'Score', { scoreBeach: async () => score }],
  ['reports', 'Reports', { create: async body => { calls++; receivedReport = body; return { ...report, confidence: body.confidence ?? 0.5 }; }, list: async () => [report] }],
  ['recommendations', 'Recommendations', { best: async () => [{ ...row, scores: score.scores, selectedScore: null, flag: 'unknown', airTemp: NaN, waterTemp: NaN, dataStatus: score.dataStatus }] }],
];
before(async () => {
  const controllers = [], providers = [];
  for (const [directory, name, useValue] of modules) {
    controllers.push(require(`../dist/modules/${directory}/${directory}.controller`)[`${name}Controller`]);
    providers.push({ provide: require(`../dist/modules/${directory}/${directory}.service`)[`${name}Service`], useValue });
  }
  const module = await Test.createTestingModule({ controllers, providers }).compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  configureHttpBoundary(app);
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
after(async () => app?.close());

test('contract: every controller route is documented exactly once', () => {
  const actual = new Set();
  const root = resolve(__dirname, '../dist/modules');
  for (const dir of readdirSync(root)) {
    for (const file of readdirSync(resolve(root, dir)).filter(f => f.endsWith('.controller.js'))) {
      for (const Controller of Object.values(require(resolve(root, dir, file)))) {
        const prefix = Reflect.getMetadata(PATH_METADATA, Controller);
        for (const name of Object.getOwnPropertyNames(Controller.prototype)) {
          const handler = Controller.prototype[name];
          const method = Reflect.getMetadata(METHOD_METADATA, handler);
          if (method === undefined) continue;
          const path = `/${prefix}/${Reflect.getMetadata(PATH_METADATA, handler)}`.replace(/\/+/g, '/').replace(/\/$/, '').replace(/:([A-Za-z]+)/g, '{$1}');
          actual.add(`${RequestMethod[method]} ${path}`);
        }
      }
    }
  }
  assert.deepEqual(actual, new Set(operations.keys()));
});

test('contract: observed, predicted, unknown, stale, zero and demo examples validate', () => {
  for (const [name, value] of Object.entries(examples)) {
    const validate = schemaValidator('Measurement');
    assert.equal(validate(value), true, `${name}: ${JSON.stringify(validate.errors)}`);
  }
  assert.equal(examples.zero.value, 0);
  assert.equal(examples.unknown.value, null);
  assert.equal(examples.demo.isDemo, true);
  for (const invalid of [NaN, Infinity, '0', undefined]) {
    assert.equal(schemaValidator('Measurement')({ ...examples.zero, value: invalid }), false);
  }
  assert.equal(schemaValidator('Measurement')({ ...examples.zero, value: null }), false);
  assert.equal(schemaValidator('Measurement')({ ...examples.unknown, value: 0 }), false);
});

test('contract: presenters preserve unknowns, zero, stale timestamps and safety separation', () => {
  const fresh = presentForecast(forecast);
  assert.equal(fresh.measurements.wind_speed_10m.value, 0);
  assert.equal(fresh.measurements.uv_index.status, 'unknown');
  const stale = presentForecast({ ...forecast, status: 'stale' });
  assert.equal(stale.measurements.wind_speed_10m.status, 'stale');
  assert.equal(stale.measurements.wind_speed_10m.fetchedAt, now);
  assert.equal(stale.measurements.wind_speed_10m.producedAt, null);
  const safety = presentScore(score).safety;
  assert.equal(safety.flag, 'red');
  assert.equal(safety.communityFlag.flag, 'red');
  assert.equal(safety.officialFlag.value, null);
  assert.equal(safety.calculatedConditions.level, 'favorable');
  const facilities = presentBeach({ ...row, has_parking: false, has_toilets: null }).facilities;
  assert.equal(facilities.parking.status, 'absent');
  assert.equal(facilities.toilets.status, 'unknown');
  assert.equal(facilities.lifeguard.status, 'present');
  assert.equal(facilities.lifeguard.verified, false);
  assert.equal(presentReport({ ...report, value: { demo: true } }).provenance.isDemo, true);
  assert.equal(presentReport({ ...report, confidence: null }).confidence, null);
});

test('contract: all public data routes return schema-conformant JSON', async () => {
  const routes = [
    ['/beaches?limit=1', '/beaches'], ['/beaches/catalogue?limit=1', '/beaches/catalogue'],
    ['/beaches/discover?bbox=43,5,44,6', '/beaches/discover'], [`/beaches/${id}`, '/beaches/{id}'],
    [`/beaches/${id}/amenities`, '/beaches/{id}/amenities'], ['/places/communes?q=Bandol', '/places/communes'],
    ['/places/communes/83009/beaches', '/places/communes/{code}/beaches'],
    ...['weather', 'marine', 'tides'].map(name => [`/${name}?lat=0&lon=0`, `/${name}`]),
    ['/water-quality', '/water-quality'], ['/alerts', '/alerts'], [`/score/beach/${id}`, '/score/beach/{id}'],
    ['/recommendations?lat=43&lon=5&usage=family', '/recommendations'], [`/reports?beachId=${id}`, '/reports'],
  ];
  for (const [path, template] of routes) {
    const response = await fetch(`${url}/api${path}`);
    const body = await response.json();
    assert.equal(response.status, 200, `${path}: ${JSON.stringify(body)}`);
    const validate = responseValidator(operations.get(`GET ${template}`), 200);
    assert.ok(validate(body), JSON.stringify(validate.errors));
    assert.equal(response.headers.get('x-api-version'), contract.info.version);
  }
  const result = await fetch(`${url}/api/beaches/catalogue?limit=1`).then(r => r.json());
  assert.deepEqual(result.items, result.beaches);
  assert.deepEqual(result.pageInfo, { nextCursor: null, hasNextPage: false, limit: 1 });
});

test('contract: invalid query/path/body never reaches a business service', async () => {
  const before = calls;
  for (const path of ['/beaches?limit=0', '/beaches?limit=wat', '/beaches?lat=91&lon=0', '/beaches?lat=0',
    '/beaches?limit=1&limit=2', '/beaches?invented=true', '/beaches/not-a-uuid', '/beaches/catalogue?after=invalid',
    '/beaches/catalogue?bbox=44,5,43,6', '/weather?lat=nan&lon=0', '/marine?lat=0&lon=181',
    '/recommendations?lat=0&lon=0&usage=invalid', '/reports', '/places/communes/invalid/beaches']) {
    const response = await fetch(`${url}/api${path}`);
    assert.equal(response.status, 400, path);
    const error = await response.json();
    assert.ok(schemaValidator('ApiError')(error), JSON.stringify(error));
    assert.equal(error.requestId, response.headers.get('x-request-id'));
  }
  for (const body of [null, {}, { beachId: id, type: 'invalid' }, { beachId: id, type: 'flag' },
    { beachId: id, type: 'other', confidence: 2 }, { beachId: id, type: 'other', confidence: '0.5' },
    { beachId: id, type: 'other', status: 'verified' }, { beachId: id, type: 'other', value: { note: 'x'.repeat(2001) } }]) {
    const response = await fetch(`${url}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(calls, before);
});

test('contract: valid contribution stays pending and preserves a zero weight', async () => {
  const response = await fetch(`${url}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ beachId: id, type: 'flag', value: { flag: 'green', source: 'detail-page' }, confidence: 0 }) });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.status, 'pending');
  assert.equal(body.provenance.verified, false);
  assert.equal(body.provenance.kind, 'contribution');
  assert.equal(body.confidence, 0);
  assert.equal(receivedReport.confidence, 0);
});

test('contract: internal failures and invalid service outputs are sanitized', async () => {
  for (const mode of ['exception', 'schema']) {
    fail = mode === 'exception'; corrupt = mode === 'schema';
    try {
      const response = await fetch(`${url}/api/beaches`);
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.equal(body.code, 'INTERNAL_ERROR');
      assert.ok(schemaValidator('ApiError')(body));
      assert.ok(!JSON.stringify(body).includes('secret'));
    } finally { fail = false; corrupt = false; }
  }
  const missing = await fetch(`${url}/api/absent`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'NOT_FOUND');
});

test('contract: OpenAPI is served without invoking providers', async () => {
  const before = calls;
  assert.deepEqual(await fetch(`${url}/api/openapi.json`).then(r => r.json()), contract);
  assert.equal(calls, before);
});
