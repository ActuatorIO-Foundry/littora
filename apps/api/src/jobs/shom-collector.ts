import { CacheService } from '../cache/cache.service';
import { boundedJson } from '../shared/bounded-json';
import { ports } from '../modules/tides/shom-ports';
import { PortCache, Product, productUrl, readHeight, readCurrent, refresh, shomKey, ttl } from '../modules/tides/shom-reference';

export const cooldown='shom:wfs:pause:v1';

export async function collectShom(cache:Pick<CacheService,'getJson'|'setJson'>,request=fetch,now=Date.now()) {
  const port=ports[Math.floor(now/60000)%ports.length], key=shomKey(port);
  const previous=await cache.getJson<PortCache>(key);
  if (previous?.station===key && previous.checked>0 && previous.checked<=now && now-previous.checked<refresh*1000) return 'cached';
  if (await cache.getJson(cooldown)) return 'cooldown';

  let failed=false;
  const get=async(product:Product) => {
    const r=await request(productUrl(product,port),{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(6000)});
    if (!r.ok) {
      await r.body?.cancel();
      if ([429,503].includes(r.status)) {
        const header=r.headers.get('retry-after') ?? '';
        const value=/^\d+$/.test(header) ? Number(header) : (Date.parse(header)-now)/1000;
        const wait=Number.isFinite(value)?Math.max(60,Math.min(86400,Math.ceil(value))):600;
        if (!await cache.setJson(cooldown,true,wait)) throw new Error('Cache unavailable');
      }
      throw new Error('SHOM unavailable');
    }
    return boundedJson(r,64*1024);
  };
  let height:PortCache['height']=null, current:PortCache['current']=null;
  try { height=readHeight(await get('ram'),port,now); } catch { failed=true; }
  if (height) {
    try { current=readCurrent(await get('vmax'),now); } catch { failed=true; }
  }
  if (!await cache.setJson(key,{station:key,height,current,checked:failed?0:now},ttl)) throw new Error('SHOM cache unavailable');
  return failed ? 'unavailable' : 'checked';
}
