import { haversineKm } from '../../shared/geo';

export type AmenityCategory = 'parking' | 'toilets' | 'rescue' | 'rental' | 'food';
export type AmenityPoint = {
  id: string; name: string; category: AmenityCategory; lat: number; lon: number;
  distanceKm: number; source: 'openstreetmap'; verification: 'listed'; sourceUpdatedAt: string | null;
};
const labels: Record<AmenityCategory, string> = {
  parking: 'Parking', toilets: 'Toilettes publiques', rescue: 'Poste de secours',
  rental: 'Location de materiel', food: 'Restauration',
};
export function amenityCategory(tags: Record<string, string>): AmenityCategory | null {
  if (['private','no'].includes(tags.access) || tags.disused === 'yes' || tags.abandoned === 'yes') return null;
  if (['parking','parking_space'].includes(tags.amenity)) return 'parking';
  if (tags.amenity === 'toilets') return 'toilets';
  if (['lifeguard','lifeguard_tower'].includes(tags.emergency) || ['base','tower','yes'].includes(tags.lifeguard)) return 'rescue';
  if (tags.amenity === 'boat_rental' || tags.shop === 'rental' || tags.rental === 'boat' || tags.rental === 'canoe' || tags.rental === 'kayak' || tags.rental === 'paddleboard') return 'rental';
  if (['restaurant','cafe','ice_cream','fast_food'].includes(tags.amenity) || tags.shop === 'ice_cream') return 'food';
  return null;
}
export function parseAmenities(raw: any, beach: {lat: number; lon: number}, candidateRadiusKm = 2.5): AmenityPoint[] {
  if (!Array.isArray(raw?.elements) || raw.remark || raw.elements.length > 5000) throw new Error('invalid-response');
  const unique = new Map<string, AmenityPoint>();
  for (const element of raw.elements) {
    const lat=element.lat ?? element.center?.lat, lon=element.lon ?? element.center?.lon;
    const category=amenityCategory(element.tags ?? {});
    if (!category || !['node','way','relation'].includes(element.type) || !Number.isSafeInteger(element.id) || element.id<=0 ||
        !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) continue;
    const distanceKm=haversineKm(beach.lat,beach.lon,lat,lon);
    if (distanceKm>candidateRadiusKm) continue;
    const id=`${element.type}/${element.id}`;
    unique.set(id,{id,name:String(element.tags.name || labels[category]).slice(0,300),category,lat,lon,
      distanceKm,source:'openstreetmap',verification:'listed',
      sourceUpdatedAt: Number.isFinite(Date.parse(element.timestamp)) ? new Date(element.timestamp).toISOString() : null});
  }
  return [...unique.values()].sort((a,b)=>a.distanceKm-b.distanceKm || a.id.localeCompare(b.id));
}

let queue: Promise<unknown> = Promise.resolve();
let pending=0, nextStart=0;
export function failureReason(error: unknown): string {
  if (!(error instanceof Error)) return 'transport';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timeout';
  if (error instanceof SyntaxError) return 'invalid-response';
  return ['rate-limit','upstream','http-error','queue-full','invalid-response','configuration'].includes(error.message)
    ? error.message : 'transport';
}
export async function fetchAmenities(beach: {lat: number; lon: number}, endpoint: string): Promise<AmenityPoint[]> {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('configuration'); }
  if (url.protocol!=='https:' || url.username || url.password || url.hostname==='overpass.osm.ch') throw new Error('configuration');
  if (pending>=4) throw new Error('queue-full');
  pending++;
  const task=queue.then(async()=>{
    const pause=nextStart-Date.now();
    if(pause>0)await new Promise(resolve=>setTimeout(resolve,pause));
    nextStart=Date.now()+2000;
    // One spatial index window for every category; the parser and PostGIS still enforce the radius.
    const dy=2.5/110, dx=dy/Math.cos((Math.abs(beach.lat)+dy)*Math.PI/180);
    const bounds=[beach.lat-dy,beach.lon-dx,beach.lat+dy,beach.lon+dx].join(',');
    const query=`[out:json][timeout:18][bbox:${bounds}];(nwr[amenity~"^(parking|parking_space|toilets|restaurant|cafe|ice_cream|fast_food|boat_rental)$"];nwr[shop~"^(rental|ice_cream)$"];nwr[rental];nwr[emergency~"^(lifeguard|lifeguard_tower)$"];nwr[lifeguard];);out meta center;`;
    const response=await fetch(url,{method:'POST',signal:AbortSignal.timeout(20000),headers:{
      'content-type':'application/x-www-form-urlencoded',accept:'application/json',
      'user-agent':'Littora/0.1 (+https://github.com/ActuatorIO-Foundry/littora)',
    },body:new URLSearchParams({data:query})});
    if(!response.ok)throw new Error(response.status === 429 ? 'rate-limit' : response.status >= 500 ? 'upstream' : 'http-error');
    let body='',bytes=0;const decoder=new TextDecoder();
    for await(const chunk of response.body as any){
      bytes+=chunk.byteLength;if(bytes>8*1024*1024)throw new Error('invalid-response');
      body+=decoder.decode(chunk,{stream:true});
    }
    return parseAmenities(JSON.parse(body+decoder.decode()),beach);
  });
  queue=task.catch(()=>undefined);
  try{return await task;}finally{pending--;}
}
