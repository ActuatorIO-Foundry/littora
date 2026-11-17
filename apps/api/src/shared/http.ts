export async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json();
}

let nominatimQueue: Promise<unknown> = Promise.resolve();
let nominatimPending = 0;
let nominatimNextStart = 0;

// One shared queue covers catalogue and amenities in this single API process.
export async function fetchNominatimJson(url: string | URL): Promise<unknown> {
  // These lookups enumerate POIs, which the public Nominatim service prohibits.
  if (!process.env.NOMINATIM_API_URL || /(^|\.)openstreetmap\.org\.?$/i.test(new URL(url).hostname))
    throw new Error('POI discovery requires a dedicated Nominatim instance');
  if (nominatimPending >= 4) throw new Error('Geographic provider busy');
  nominatimPending++;
  const request = nominatimQueue.then(async () => {
    const delay = nominatimNextStart - Date.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    nominatimNextStart = Date.now() + 1100;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: {
      accept: 'application/json', 'user-agent': 'Littora/0.1 (+https://github.com/ActuatorIO-Foundry/littora)',
    } });
    if (!response.ok) throw new Error('Geographic provider unavailable');
    const body = await response.text();
    if (body.length > 8 * 1024 * 1024) throw new Error('Geographic response too large');
    return JSON.parse(body);
  });
  nominatimQueue = request.catch(() => undefined);
  try { return await request; } finally { nominatimPending--; }
}
export function num(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
