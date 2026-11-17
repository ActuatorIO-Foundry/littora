import { CacheService } from '../cache/cache.service';

export interface ForecastData {
  provider: string;
  kind: 'forecast';
  status: 'available' | 'partial' | 'stale' | 'unknown';
  fetchedAt: string | null;
  validAt: string | null;
  ageSeconds: number | null;
  current: Record<string, number | string | null>;
  raw?: { hourly: Record<string, any[]>; [key: string]: any };
  warning?: string;
}

export const finiteMetric = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// Only provider-backed forecasts enter this namespace, never legacy estimates.
export async function forecastData(
  cache: CacheService, provider: string, lat: number, lon: number,
  keys: string[], fetchData: () => Promise<any>,
): Promise<ForecastData> {
  const key = `forecast:real:v1:${provider}:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  const last = await cache.getJson<ForecastData>(key);
  const age = last?.fetchedAt ? (Date.now() - Date.parse(last.fetchedAt)) / 1000 : NaN;
  const reusable = last?.kind === 'forecast' && last.provider === provider &&
    Number.isFinite(age) && age >= 0 && age < 86400;
  if (reusable && age < 900) return { ...last, ageSeconds: Math.floor(age) };

  try {
    const response = await fetchData();
    const times = response?.hourly?.time;
    if (!Array.isArray(times) || !times.length) throw new Error('Missing forecast');
    // Requests use Unix seconds in GMT, independent of the server timezone.
    const time = times.map((t: unknown) => typeof t === 'number' && Number.isFinite(t) &&
      Number.isFinite(new Date(t * 1000).getTime()) ? new Date(t * 1000).toISOString() : null);
    const hourly: Record<string, any[]> = { time };
    for (const metric of keys) hourly[metric] = times.map((_, i) => finiteMetric(response.hourly[metric]?.[i]));
    if (!time.some((t, i) => t && keys.some(k => hourly[k][i] !== null))) throw new Error('Empty forecast');
    const now = Date.now();
    let nearest = -1, distance = 3600_000;
    time.forEach((t, i) => {
      const delta = t ? Math.abs(Date.parse(t) - now) : Infinity;
      if (delta < distance) { nearest = i; distance = delta; }
    });
    const current: ForecastData['current'] = { time: time[nearest] ?? null };
    for (const metric of keys) current[metric] = nearest >= 0 ? hourly[metric][nearest] : null;
    const count = keys.filter(k => current[k] !== null).length;
    const payload: ForecastData = {
      provider, kind: 'forecast', status: count === keys.length ? 'available' : count ? 'partial' : 'unknown',
      fetchedAt: new Date(now).toISOString(), validAt: time[nearest] ?? null, ageSeconds: 0,
      current, raw: { ...response, hourly, hourly_units: { ...response.hourly_units, time: 'iso8601' } },
    };
    await cache.setJson(key, payload, 86400);
    return payload;
  } catch {
    if (reusable) return { ...last, status: 'stale', ageSeconds: Math.floor(age), warning: 'Provider unavailable; last successful forecast retained.' };
    return {
      provider, kind: 'forecast', status: 'unknown', fetchedAt: null, validAt: null, ageSeconds: null,
      current: Object.fromEntries(['time', ...keys].map(k => [k, null])),
      warning: 'Provider unavailable; no recent forecast cached.',
    };
  }
}
