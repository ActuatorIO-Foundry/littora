import { Injectable } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { fetchJson } from '../../shared/http';
import { forecastData } from '../../shared/forecast-data';

const weatherKeys = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation',
  'cloud_cover', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'uv_index',
];

@Injectable()
export class WeatherService {
  constructor(private readonly cache: CacheService) {}

  async get(lat: number, lon: number) {
    return process.env.WEATHER_PROVIDER === 'meteofrance'
      ? this.getMeteoFrance(lat, lon) : this.getOpenMeteo(lat, lon);
  }

  getOpenMeteo(lat: number, lon: number) {
    return forecastData(this.cache, 'open-meteo', lat, lon, weatherKeys, () => fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${weatherKeys.join(',')}&forecast_days=3&timezone=GMT&timeformat=unixtime`,
    ));
  }

  async getMeteoFrance(lat: number, lon: number) {
    const data = await this.getOpenMeteo(lat, lon);
    return {
      ...data, requestedProvider: 'meteofrance',
      warning: [data.warning, 'Direct Meteo-France adapter not connected; actual source is Open-Meteo.'].filter(Boolean).join(' '),
    };
  }
}
