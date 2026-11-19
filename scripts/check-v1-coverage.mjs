import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const { COASTAL_ZONES } = createRequire(import.meta.url)('../apps/web/src/app/shared/coastal-zones.ts');

const sectors = COASTAL_ZONES.map(({ id, bbox }) => ({ id, bounds: bbox.split(',').map(Number) }));
const types = ['sea', 'lake', 'river', 'unknown'];
const metric = value => value === null || Number.isFinite(value);
function freshForecast(data, at) {
  const age = at - Date.parse(data?.fetchedAt);
  return !!data?.provider && data.provider !== 'unknown' && data.kind === 'forecast' &&
    ['available', 'partial'].includes(data.status) && age >= 0 && age < 21600000 &&
    Math.abs(at - Date.parse(data.validAt)) < 3600000;
}

// Read the same frozen result set as a visitor. Never visit a detail page to warm its cache.
export async function inspectCoverage(readPage) {
  const water = Object.fromEntries(types.map(type => [type, 0]));
  const coasts = Object.fromEntries(sectors.map(({ id }) => [id, 0]));
  const ids = new Set(), cursors = new Set();
  let air = 0, seaTemperature = 0, inlandMarine = 0, total, asOf, cursor;
  do {
    const page = await readPage({ limit: 200, ...(cursor ? { cursor } : {}) });
    if (!Number.isSafeInteger(page.total) || page.total < 0 || !Number.isFinite(Date.parse(page.asOf)) ||
        !Array.isArray(page.items) || page.items.length > 200 ||
        (total !== undefined && (page.total !== total || page.asOf !== asOf))) {
      throw new Error('Invalid or inconsistent search snapshot');
    }
    ({ total, asOf } = page);
    const at = Date.parse(asOf);
    for (const b of page.items) {
      if (typeof b?.id !== 'string' || !b.id || ids.has(b.id) || !types.includes(b.waterType) ||
          !Number.isFinite(b.lat) || !Number.isFinite(b.lon) || Math.abs(b.lat)>90 || Math.abs(b.lon)>180 ||
          !metric(b.airTemp) || !metric(b.waterTemp) || !b.conditions ||
          !Object.hasOwn(b.conditions,'weather') || !Object.hasOwn(b.conditions,'marine')) {
        throw new Error('Invalid or duplicate catalogue item');
      }
      ids.add(b.id);
      water[b.waterType]++;
      if (b.airTemp !== null && freshForecast(b.conditions.weather, at)) air++;
      if (b.waterType === 'sea') {
        if (b.waterTemp !== null && freshForecast(b.conditions.marine, at)) seaTemperature++;
        for (const {id, bounds:[s,w,n,e]} of sectors)
          if (b.lat>=s && b.lat<=n && b.lon>=w && b.lon<=e) coasts[id]++;
      } else if (b.conditions.marine !== null) inlandMarine++;
    }
    cursor = page.pageInfo?.nextCursor;
    const more = cursor !== null;
    if (page.pageInfo?.hasNextPage !== more || (more && (
      typeof cursor !== 'string' || !cursor || cursors.has(cursor) || !page.items.length || ids.size >= total))) {
      throw new Error('Invalid search pagination');
    }
    cursors.add(cursor);
  } while (cursor);
  if (ids.size !== total) throw new Error('Incomplete search snapshot');

  const classified = total - water.unknown;
  const checks = {
    coastalPresence: sectors.every(({id}) => coasts[id] > 0),
    freshwaterPresence: water.lake > 0 && water.river > 0,
    classified90: total > 0 && classified * 100 >= total * 90,
    air90: total > 0 && air * 100 >= total * 90,
    seaTemperature80: water.sea > 0 && seaTemperature * 100 >= water.sea * 80,
    noMarineOnNonSea: inlandMarine === 0,
  };
  const catalogueIds = createHash('sha256').update([...ids].sort().join(',')).digest('hex');
  return { asOf, total, catalogueIds, water, coasts, classified, air, seaTemperature, inlandMarine, checks,
    coverageMet: Object.values(checks).every(Boolean) };
}

export function measureSite(site = 'http://127.0.0.1:4200') {
  const endpoint = new URL('/api/search/beaches',site);
  return inspectCoverage(async body => {
    const r = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body), redirect:'error', signal:AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('Search HTTP ' + r.status);
    return r.json();
  });
}

if (import.meta.main) {
  try {
    const report = await measureSite(process.argv[2]);
    console.log(JSON.stringify(report, null, 2));
    if (!report.coverageMet) process.exitCode = 2;
  } catch (e) {
    console.error('Coverage could not be measured:', e.message);
    process.exitCode = 1;
  }
}
