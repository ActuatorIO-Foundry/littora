import { Injectable } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { fetchJson } from '../../shared/http';

const weatherKeys = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation',
  'cloud_cover',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'uv_index',
];

@Injectable()
export class WeatherService {
  constructor(private readonly cache: CacheService) {}

  async get(lat: number, lon: number): Promise<any> {
    const provider = process.env.WEATHER_PROVIDER || 'openmeteo';
    return provider === 'meteofrance' ? this.getMeteoFrance(lat, lon) : this.getOpenMeteo(lat, lon);
  }

  async getOpenMeteo(lat: number, lon: number): Promise<any> {
    const cacheKey = `weather:openmeteo:${lat.toFixed(3)}:${lon.toFixed(3)}`;
    const cached = await this.cache.getJson<Record<string, any>>(cacheKey);
    if (cached) return cached;

    try {
      const hourly = weatherKeys.join(',');
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${hourly}&forecast_days=3&timezone=auto`;
      const raw = await fetchJson(url);
      const payload = {
        provider: 'open-meteo',
        raw,
        current: this.pickNearest(raw.hourly, weatherKeys),
      };
      await this.cache.setJson(cacheKey, payload, 900);
      return payload;
    } catch (error) {
      return {
        provider: 'local-weather-fallback',
        warning: error instanceof Error ? error.message : 'Open-Meteo unavailable',
        current: this.estimate(lat, lon),
      };
    }
  }

  async getMeteoFrance(lat: number, lon: number): Promise<any> {
    const key = process.env.METEOFRANCE_API_KEY;
    if (!key) {
      return {
        ...(await this.getOpenMeteo(lat, lon)),
        provider: 'open-meteo-fallback',
        warning: 'METEOFRANCE_API_KEY missing',
      };
    }

    return {
      ...(await this.getOpenMeteo(lat, lon)),
      provider: 'open-meteo-mapped',
      warning: 'Meteo-France key detected. Configure the chosen forecast/vigilance product endpoint before replacing Open-Meteo mapping.',
    };
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

  estimate(lat: number, lon: number) {
    const month = new Date().getMonth();
    const mediterranean = lon > 3 && lat < 45;
    const summerBoost = Math.max(0, Math.sin(((month + 1) / 12) * Math.PI));
    return {
      time: new Date().toISOString(),
      temperature_2m: Number((13 + summerBoost * 16 + (mediterranean ? 2 : 0)).toFixed(1)),
      apparent_temperature: Number((13 + summerBoost * 16 + (mediterranean ? 2 : 0)).toFixed(1)),
      relative_humidity_2m: mediterranean ? 62 : 72,
      precipitation: 0,
      cloud_cover: mediterranean ? 24 : 48,
      wind_speed_10m: mediterranean ? 13 : 18,
      wind_gusts_10m: mediterranean ? 24 : 32,
      wind_direction_10m: mediterranean ? 145 : 260,
      uv_index: Number((2 + summerBoost * 6).toFixed(1)),
    };
  }
}
