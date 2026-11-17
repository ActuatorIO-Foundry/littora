import { forecastUnits, normalizeMetric } from './forecast-units';

export const sources = {
  'open-meteo': { endpoint: 'https://api.open-meteo.com/v1/forecast', keys: [
    'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation',
    'cloud_cover', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'uv_index',
  ] },
  'open-meteo-marine': { endpoint: 'https://marine-api.open-meteo.com/v1/marine', keys: [
    'wave_height', 'wave_direction', 'wave_period', 'swell_wave_height', 'swell_wave_direction',
    'swell_wave_period', 'wind_wave_height', 'sea_surface_temperature', 'ocean_current_velocity', 'ocean_current_direction',
  ] },
};
export type Source = keyof typeof sources;
export const refreshSeconds = 6 * 3600;
export const finiteMetric = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
type Series = { hourly: Record<string, any[]>; hourly_units: Record<string,string>; sourceUnits: Record<string,string> };
export interface ForecastData {
  provider: string; kind: 'forecast'; status: 'available' | 'partial' | 'stale' | 'unknown';
  fetchedAt: string | null; validAt: string | null; ageSeconds: number | null; producedAt: string | null;
  nextCheckAt?: string | null; collectionIntervalSeconds?: number;
  units: Record<string,string>; sourceUnits?: Record<string,string>;
  current: Record<string, number | string | null>; raw?: Series; warning?: string;
}

export function normalizeForecast(source: Source, response: any): Series {
  const keys = sources[source].keys;
  const times = response?.hourly?.time;
  if (!Array.isArray(times) || !times.length || times.length > 96) throw new Error('empty');
  const time = times.map((v: unknown) => typeof v === 'number' && Number.isFinite(new Date(v*1000).getTime())
    ? new Date(v*1000).toISOString() : null);
  const hourly: Series['hourly'] = { time };
  const units = Object.fromEntries(keys.map(k => [k, forecastUnits[k].unit]));
  for (const k of keys) hourly[k] = time.map((_, i) => normalizeMetric(k, response.hourly[k]?.[i], response.hourly_units?.[k]));
  if (!time.some((t,i) => t && keys.some(k => hourly[k][i] !== null))) throw new Error('empty');
  return { hourly, hourly_units: { ...units, time: 'iso8601' }, sourceUnits: response.hourly_units ?? {} };
}

export type ForecastRow = { payload: Series | null; last_success_at: Date | null; next_check_at: Date; error_code: string | null };
export function readForecast(source: Source, row?: ForecastRow, now = Date.now()): ForecastData {
  const keys = sources[source].keys;
  const age = row?.last_success_at ? Math.floor((now - row.last_success_at.getTime())/1000) : null;
  const raw = age !== null && age >= 0 && age < 86400 ? row?.payload ?? undefined : undefined;
  const units = Object.fromEntries(keys.map(k => [k, forecastUnits[k].unit]));
  let nearest = -1, distance = 3600_000;
  raw?.hourly.time.forEach((t,i) => {
    const d = Math.abs(now - Date.parse(t));
    if (d < distance) { distance = d; nearest = i; }
  });
  const validAt = raw?.hourly.time[nearest] ?? null;
  const current = Object.fromEntries(keys.map(k => [k, raw?.hourly[k][nearest] ?? null]));
  const n = keys.filter(k => current[k] !== null).length;
  const status = !n ? 'unknown' : row?.error_code || age! >= refreshSeconds ? 'stale' : n < keys.length ? 'partial' : 'available';
  return { provider: source, kind: 'forecast', status, current: { ...current, time: validAt }, units,
    fetchedAt: row?.last_success_at?.toISOString() ?? null, ageSeconds: age, validAt, producedAt: null,
    nextCheckAt: row?.next_check_at.toISOString() ?? null, collectionIntervalSeconds: refreshSeconds,
    raw, sourceUnits: raw?.sourceUnits,
    ...(status === 'unknown' ? { warning: 'No usable forecast for this time and zone.' }
      : status === 'stale' ? { warning: 'Last successful forecast; refresh overdue or unavailable.' } : {}) };
}
