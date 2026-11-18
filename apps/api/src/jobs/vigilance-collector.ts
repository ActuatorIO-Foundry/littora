import { CacheService } from '../cache/cache.service';
import { Cached, cacheKey, freshnessMs, parseBulletin } from '../modules/alerts/vigilance';

const endpoint = 'https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours';
const maxBytes = 4 * 1024 * 1024;

async function readProduct(response:Response) {
  if (!response.body || Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel(); throw new Error('Invalid size');
  }
  const reader = response.body.getReader(), chunks:Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done,value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Invalid size'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function collectVigilance(cache:Pick<CacheService,'getJson'|'setJson'>,
    key = process.env.METEOFRANCE_API_KEY, request = fetch, now = Date.now()) {
  const previous = await cache.getJson<Cached>(cacheKey);
  let result:Cached, ttl = freshnessMs/1000;
  if (!key?.trim()) result = {reason:'disabled'};
  else if (previous && 'reason' in previous && previous.reason === 'rate_limited') return 'rate_limited';
  else try {
    const response = await request(endpoint, { headers: { apikey:key, Accept:'application/json' },
      signal:AbortSignal.timeout(8000), redirect:'error' });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) {
        const retry = response.headers.get('retry-after') ?? '';
        const seconds = /^\d+$/.test(retry) ? Number(retry) : (Date.parse(retry)-now)/1000;
        ttl = Number.isFinite(seconds) ? Math.max(300,Math.min(86400,Math.ceil(seconds))) : 300;
        result = {reason:'rate_limited'};
      } else result = {reason:[401,403].includes(response.status) ? 'unauthorized':'unavailable'};
    } else {
      const bulletin = parseBulletin(await readProduct(response),now);
      if (previous && 'bulletin' in previous && bulletin.issued < previous.bulletin.issued) throw new Error('Older bulletin');
      result = {bulletin};
    }
  } catch { result = {reason:'unavailable'}; }
  if (!await cache.setJson(cacheKey,result,ttl)) throw new Error('Vigilance cache unavailable');
  return 'reason' in result ? result.reason : 'available';
}
