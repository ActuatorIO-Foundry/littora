import { Injectable } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { fetchJson } from '../../shared/http';

const marineKeys = [
  'wave_height',
  'wave_direction',
  'wave_period',
  'swell_wave_height',
  'swell_wave_direction',
  'swell_wave_period',
  'wind_wave_height',
  'sea_surface_temperature',
  'ocean_current_velocity',
  'ocean_current_direction',
];

@Injectable()
export class MarineService {
  constructor(private readonly cache: CacheService) {}

  async get(lat: number, lon: number): Promise<any> {
    const cacheKey = `marine:openmeteo:${lat.toFixed(3)}:${lon.toFixed(3)}`;
    const cached = await this.cache.getJson<Record<string, any>>(cacheKey);
    if (cached) return cached;

    try {
      const hourly = marineKeys.join(',');
      const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=${hourly}&forecast_days=3&timezone=auto`;
      const raw = await fetchJson(url);
      const payload = {
        provider: 'open-meteo-marine',
        raw,
        current: this.withDerivedMetrics(lat, lon, this.pickNearest(raw.hourly, marineKeys)),
      };
      await this.cache.setJson(cacheKey, payload, 900);
      return payload;
    } catch (error) {
      return {
        provider: 'local-marine-fallback',
        warning: error instanceof Error ? error.message : 'Open-Meteo marine unavailable',
        current: this.estimate(lat, lon),
      };
    }
  }

  pickNearest(hourly: Record<string, unknown[]>, keys: string[]) {
    const times = Array.isArray(hourly?.time) ? (hourly.time as string[]) : [];
    const now = Date.now();
    const index = times.reduce((best, time, currentIndex) => {
      const delta = Math.abs(new Date(time).getTime() - now);
      const bestDelta = Math.abs(new Date(times[best] ?? 0).getTime() - now);
      return delta < bestDelta ? currentIndex : best;
    }, 0);

    const out: Record<string, unknown> = { time: times[index] ?? new Date().toISOString() };
    for (const key of keys) out[key] = hourly?.[key]?.[index] ?? null;
    return out;
  }

  withDerivedMetrics(lat: number, lon: number, current: Record<string, unknown>) {
    const mediterranean = lon > 3 && lat < 45;
    return {
      ...current,
      salinity_ppt: mediterranean ? 38 : 35,
      jellyfish_risk: this.jellyfishRisk(current, mediterranean),
    };
  }

  estimate(lat: number, lon: number) {
    const month = new Date().getMonth();
    const mediterranean = lon > 3 && lat < 45;
    const summerBoost = Math.max(0, Math.sin(((month + 1) / 12) * Math.PI));
    return {
      time: new Date().toISOString(),
      wave_height: mediterranean ? 0.45 : 1.1,
      wave_direction: mediterranean ? 150 : 275,
      wave_period: mediterranean ? 4.8 : 8.2,
      swell_wave_height: mediterranean ? 0.25 : 0.9,
      swell_wave_direction: mediterranean ? 150 : 280,
      swell_wave_period: mediterranean ? 4.2 : 9.4,
      wind_wave_height: mediterranean ? 0.25 : 0.45,
      sea_surface_temperature: Number((13 + summerBoost * 12 + (mediterranean ? 3 : 0)).toFixed(1)),
      ocean_current_velocity: mediterranean ? 0.08 : 0.18,
      ocean_current_direction: mediterranean ? 120 : 35,
      salinity_ppt: mediterranean ? 38 : 35,
      jellyfish_risk: mediterranean && month >= 5 && month <= 8 ? 'medium' : 'low',
    };
  }

  jellyfishRisk(current: Record<string, unknown>, mediterranean: boolean) {
    const waterTemp = Number(current.sea_surface_temperature ?? 0);
    const waveHeight = Number(current.wave_height ?? 0);
    if (mediterranean && waterTemp >= 24 && waveHeight < 0.8) return 'medium';
    return 'low';
  }
}
