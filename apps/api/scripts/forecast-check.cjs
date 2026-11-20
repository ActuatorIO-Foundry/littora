const { Pool } = require('pg');
const { Queue } = require('bullmq');
const { readFile } = require('node:fs/promises');
const { readDispatch } = require('../dist/jobs/forecast-dispatch');
const Redis = require('ioredis');
const { cacheKey, freshnessMs } = require('../dist/modules/alerts/vigilance');
const { ports } = require('../dist/modules/tides/shom-ports');
const { shomKey, ttl } = require('../dist/modules/tides/shom-reference');
const { cooldown } = require('../dist/jobs/shom-collector');

async function officialAlerts(cache, vigilanceEnabled, now = Date.now()) {
  const keys = ports.map(shomKey);
  const [bulletin, pause, ...records] = await cache.mget(cacheKey, cooldown, ...keys);
  const alerts = [];
  if (vigilanceEnabled) {
    const value = JSON.parse(bulletin), fetched = value?.bulletin?.fetched;
    if (['rate_limited','unauthorized','unavailable'].includes(value?.reason))
      alerts.push({code:'provider_error',source:'meteo-france-vigilance',reason:value.reason});
    else if (!(Number.isFinite(fetched) && fetched <= now && now - fetched < freshnessMs))
      alerts.push({code:'no_recent_check',source:'meteo-france-vigilance'});
  }
  const samples = records.map((raw, i) => {
    if (raw === null) return null;
    const row = JSON.parse(raw);
    if (row?.station !== keys[i] || !Number.isFinite(row.checked)) throw Error('Invalid source state');
    return row.checked;
  });
  if (pause !== null) alerts.push({code:'provider_cooldown',source:'shom'});
  const failures = samples.filter(t => t === 0).length;
  if (failures) alerts.push({code:'provider_error',source:'shom',stations:failures});
  if (!samples.some(t => t > 0 && t <= now && now - t < ttl * 1000)) alerts.push({code:'no_recent_check',source:'shom'});
  return alerts;
}

async function inspect(db, queues, heartbeat, now = Date.now()) {
  const alerts = [];
  if (!Number.isSafeInteger(heartbeat) || heartbeat <= 0 || heartbeat > now || now - heartbeat >= 120_000)
    alerts.push({ code: 'worker_silent' });
  const sources = await readDispatch(db);
  if (!sources.length) alerts.push({ code: 'no_forecast_targets' });
  for (const {source, errors, zones, neverCollected, stale} of sources) {
    if (errors) alerts.push({ code: 'provider_error', source, zones: errors });
    if (zones === neverCollected + stale) alerts.push({ code: 'no_recent_forecast', source, zones });
  }
  for (const queue of queues) {
    await queue.waitUntilReady();
    const [job] = await queue.getFailed(0, 0);
    if (job && (!Number.isSafeInteger(job.finishedOn) || job.finishedOn > now - 900_000))
      alerts.push({ code: 'recent_job_failure', queue: queue.name });
    if (await queue.isPaused()) alerts.push({ code: 'queue_paused', queue: queue.name });
    const waiting = await queue.getWaitingCount();
    if (waiting >= 30) alerts.push({ code: 'queue_backlog', queue: queue.name, waiting });
  }
  return { status: alerts.length ? 'alert' : 'ok', alerts };
}

async function main() {
  const url = process.env.JOBS_REDIS_URL || process.env.REDIS_URL;
  if (!process.env.DATABASE_URL || !url || !process.env.REDIS_URL) throw Error('Missing configuration');
  const db = new Pool({connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 3000, statement_timeout: 4000});
  db.on('error', () => {});
  const cache = new Redis(process.env.REDIS_URL, {lazyConnect:true, connectTimeout:3000, commandTimeout:4000,
    maxRetriesPerRequest:1, enableOfflineQueue:false, retryStrategy:()=>null});
  cache.on('error', () => {});
  const names = ['littora-weather', ...(process.env.ARS_IMPORT_ENABLED === 'true' ? ['littora-ars'] : [])];
  const queues = names.map(name => {
    const q = new Queue(name, {skipMetasUpdate: true, connection: { url, maxRetriesPerRequest: 1,
      connectTimeout: 3000, commandTimeout: 4000, retryStrategy: () => null }});
    q.on('error', () => {});
    return q;
  });
  try {
    const heartbeat = Number(await readFile('/tmp/littora-weather-heartbeat', 'utf8').catch(() => ''));
    await cache.connect();
    const report = await inspect(db, queues, heartbeat);
    report.alerts.push(...await officialAlerts(cache, Boolean(process.env.METEOFRANCE_API_KEY?.trim())));
    if (report.alerts.length) report.status = 'alert';
    return report;
  } finally {
    cache.disconnect();
    await Promise.all([...queues.map(q => q.close()), db.end()]);
  }
}

if (require.main === module) {
  const unknown = () => { console.log(JSON.stringify({ status: 'unknown', alerts: [{code: 'check_unavailable'}] })); };
  const deadline = setTimeout(() => { unknown(); process.exit(1); }, 12000);
  main().then(result => { console.log(JSON.stringify(result)); process.exitCode = result.status === 'ok' ? 0 : 2; },
    () => { unknown(); process.exitCode = 1; }).finally(() => clearTimeout(deadline));
}
module.exports = { inspect, officialAlerts };
