const { mkdirSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { Pool } = require('pg');
const { assertCurrent } = require('./database.cjs');
const { classificationSource, classificationLayers, normalizeReferences, classifyPosition, decideWaterType } = require('../dist/modules/beaches/water-classification');

const save = (path, value) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
function tile(beach) {
  const west = Math.floor(beach.lon * 10) / 10, south = Math.floor(beach.lat * 10) / 10;
  return { key: `${west.toFixed(1)}_${south.toFixed(1)}`, bbox: [west - 0.005, south - 0.005, west + 0.105, south + 0.105] };
}
async function fetchPage(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: {
    accept: 'application/json', 'user-agent': 'Littora/0.1 (+https://github.com/ActuatorIO-Foundry/littora)',
  } });
  if (!response.ok) throw new Error(`Geographic source HTTP ${response.status}`);
  let body = '', bytes = 0;
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 16 * 1024 * 1024) throw new Error('Geographic response too large');
    body += decoder.decode(chunk, { stream: true });
  }
  return JSON.parse(body + decoder.decode());
}
async function fetchLayer(layer, bbox) {
  const url = new URL(classificationSource);
  // WFS 1.0 explicitly uses longitude/latitude for this EPSG:4326 bounding box.
  url.search = new URLSearchParams({ service: 'WFS', version: '1.0.0', request: 'GetFeature',
    typeName: `BDTOPO_V3:${layer}`, srsName: 'EPSG:4326', outputFormat: 'application/json',
    bbox: [...bbox, 'EPSG:4326'].join(','), maxFeatures: '1000', sortBy: 'cleabs', startIndex: '0' }).toString();
  const collection = { type: 'FeatureCollection', features: [], totalFeatures: null };
  const ids = new Set();
  for (let page = 0; page < 5; page++) {
    if (page) await delay(200);
    url.searchParams.set('startIndex', String(collection.features.length));
    const data = await fetchPage(url);
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || !Number.isInteger(data.totalFeatures) ||
        data.totalFeatures > 5000 || (collection.totalFeatures !== null && data.totalFeatures !== collection.totalFeatures)) {
      throw new Error('Incomplete geographic reference');
    }
    collection.totalFeatures = data.totalFeatures;
    for (const feature of data.features) {
      if (ids.has(feature.id)) throw new Error('Unstable geographic pagination');
      ids.add(feature.id);
    }
    collection.features.push(...data.features);
    if (collection.features.length === collection.totalFeatures) break;
    if (!data.features.length) throw new Error('Incomplete geographic reference');
  }
  normalizeReferences(layer, collection);
  url.searchParams.set('startIndex', '0');
  return { collection, url: url.href, collectedAt: new Date().toISOString() };
}

async function collect(pool, output) {
  const cache = resolve(dirname(output), 'water-reference-cache');
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  const beaches = (await pool.query('select id,lat,lon from beaches order by id')).rows;
  const groups = new Map();
  for (const beach of beaches) {
    const area = tile(beach);
    if (!groups.has(area.key)) groups.set(area.key, { ...area, beaches: [] });
    groups.get(area.key).beaches.push(beach);
  }
  const report = { version: 1, sourceUrl: classificationSource, generatedAt: new Date().toISOString(),
    catalogueCount: beaches.length, classifications: [], failures: [] };
  for (const area of groups.values()) {
    let references = [], collectedAt = report.generatedAt, unavailable = false;
    try {
      const dates = [];
      for (const layer of classificationLayers) {
        const path = resolve(cache, `${area.key}_${layer}.json`);
        let entry = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
        if (!entry || Date.now() - Date.parse(entry.collectedAt) > 7 * 86400_000) {
          await delay(200);
          entry = await fetchLayer(layer, area.bbox);
          save(path, entry);
        }
        references.push(...normalizeReferences(layer, entry.collection));
        dates.push(entry.collectedAt);
      }
      collectedAt = dates.sort()[0];
    } catch (error) {
      unavailable = true;
      report.failures.push({ tile: area.key, reason: error.message });
    }
    for (const beach of area.beaches) {
      let decision = { waterType: 'unknown', reason: 'source-unavailable', evidence: [] };
      if (!unavailable) {
        try { decision = await classifyPosition(pool, beach, references); }
        catch { report.failures.push({ beachId: beach.id, reason: 'Invalid geographic geometry' }); }
      }
      report.classifications.push({ beachId: beach.id, lat: beach.lat, lon: beach.lon, classifiedAt: collectedAt, ...decision });
    }
    save(output, report);
    console.log(JSON.stringify({ processed: report.classifications.length, total: beaches.length, failures: report.failures.length }));
  }
  return report;
}

function validateReport(report) {
  if (report?.version !== 1 || report.sourceUrl !== classificationSource || !Array.isArray(report.classifications) ||
      report.classifications.length !== report.catalogueCount) throw new Error('Incomplete classification report');
  const ids = new Set();
  for (const row of report.classifications) {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.beachId) || ids.has(row.beachId) ||
        !Number.isFinite(row.lat) || !Number.isFinite(row.lon) || !Number.isFinite(Date.parse(row.classifiedAt)) ||
        !['sea', 'river', 'lake', 'unknown'].includes(row.waterType) || typeof row.reason !== 'string' ||
        !Array.isArray(row.evidence) || (row.waterType !== 'unknown' && !row.evidence.length)) throw new Error('Invalid classification');
    ids.add(row.beachId);
    if (row.evidence.length > 12 || row.evidence.some(e => !e || typeof e.referenceId !== 'string' ||
        typeof e.layer !== 'string' || typeof e.nature !== 'string' || !['sea', 'river', 'lake', 'unknown'].includes(e.waterType) ||
        !Number.isFinite(e.distanceMeters) || e.distanceMeters < 0 || e.distanceMeters > 200 ||
        (e.sourceUpdatedAt !== null && !Number.isFinite(Date.parse(e.sourceUpdatedAt))))) throw new Error('Invalid geographic evidence');
    if (row.waterType !== 'unknown' && decideWaterType(row.evidence).waterType !== row.waterType) throw new Error('Classification contradicts evidence');
  }
}

async function apply(pool, report) {
  validateReport(report);
  await assertCurrent(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query('LOCK TABLE beaches IN SHARE MODE');
    // Freeze identity/position only during application. Never insert, update or delete a beach.
    const current = (await client.query('select id,lat,lon from beaches order by id for share')).rows;
    const byId = new Map(current.map(b => [b.id, b]));
    if (current.length !== report.catalogueCount) throw new Error('Catalogue changed; recollect before applying');
    let applied = 0;
    for (const row of report.classifications) {
      const beach = byId.get(row.beachId);
      if (!beach || beach.lat !== row.lat || beach.lon !== row.lon) throw new Error('Beach position changed; recollect before applying');
      if (row.reason === 'source-unavailable') continue;
      const result = await client.query(`insert into beach_water_classifications
        (beach_id,lat,lon,water_type,method,source_url,classified_at,reason,evidence)
        values($1,$2,$3,$4,'ign-proximity-v1',$5,$6,$7,$8)
        on conflict(beach_id) do update set lat=excluded.lat,lon=excluded.lon,water_type=excluded.water_type,
        source_url=excluded.source_url,classified_at=excluded.classified_at,reason=excluded.reason,evidence=excluded.evidence
        where beach_water_classifications.method <> 'reviewed'
          and beach_water_classifications.classified_at <= excluded.classified_at`,
      [row.beachId, row.lat, row.lon, row.waterType, report.sourceUrl, row.classifiedAt, row.reason, JSON.stringify(row.evidence)]);
      applied += result.rowCount;
    }
    await client.query('COMMIT');
    return { applied, catalogueCount: current.length, failed: report.failures?.length ?? 0 };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function review(pool, beachId, waterType, sourceUrl, reason) {
  const url = new URL(sourceUrl);
  if (!['sea', 'lake', 'river', 'unknown'].includes(waterType) || typeof reason !== 'string' || reason.trim().length < 10 ||
      url.protocol !== 'https:' || url.username || url.password) throw new Error('Review requires a water type, HTTPS source and justification');
  await assertCurrent(pool);
  const evidence = [{ referenceId: sourceUrl, layer: 'documented-review', nature: reason, waterType,
    distanceMeters: null, sourceUpdatedAt: null }];
  const result = await pool.query(`insert into beach_water_classifications
    (beach_id,lat,lon,water_type,method,source_url,classified_at,reason,evidence)
    select id,lat,lon,$2,'reviewed',$3,now(),$4,$5 from beaches where id=$1
    on conflict(beach_id) do update set lat=excluded.lat,lon=excluded.lon,water_type=excluded.water_type,
    method=excluded.method,source_url=excluded.source_url,classified_at=excluded.classified_at,reason=excluded.reason,evidence=excluded.evidence`,
  [beachId, waterType, sourceUrl, reason, JSON.stringify(evidence)]);
  if (result.rowCount !== 1) throw new Error('Unknown beach');
  return { reviewed: beachId, waterType };
}

async function main() {
  const [command, path, waterType, sourceUrl, reason] = process.argv.slice(2);
  if (!['collect', 'apply', 'review'].includes(command) || !path || !process.env.DATABASE_URL) {
    throw new Error('Use DATABASE_URL=... node scripts/classify-water.cjs collect|apply report.json OR review beachId waterType sourceUrl justification');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
  try {
    if (command === 'collect') await collect(pool, resolve(path));
    else if (command === 'apply') console.log(JSON.stringify(await apply(pool, JSON.parse(readFileSync(resolve(path), 'utf8')))));
    else console.log(JSON.stringify(await review(pool, path, waterType, sourceUrl, reason)));
  } finally { await pool.end(); }
}
module.exports = { collect, apply, review, tile, fetchLayer, validateReport };
if (require.main === module) main().catch(() => { console.error('{"event":"classification_failed"}'); process.exitCode = 1; });
