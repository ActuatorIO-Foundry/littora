import { Injectable } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { fetchJson } from '../../shared/http';
import { forecastData, ForecastData } from '../../shared/forecast-data';

const marineKeys = [
  'wave_height', 'wave_direction', 'wave_period', 'swell_wave_height', 'swell_wave_direction',
  'swell_wave_period', 'wind_wave_height', 'sea_surface_temperature',
  'ocean_current_velocity', 'ocean_current_direction',
];

@Injectable()
export class MarineService {
  constructor(private readonly cache: CacheService) {}

  async get(lat: number, lon: number): Promise<ForecastData> {
    const data = await forecastData(this.cache, 'open-meteo-marine', lat, lon, marineKeys, () => fetchJson(
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=${marineKeys.join(',')}&forecast_days=3&timezone=GMT&timeformat=unixtime`,
    ));
    return { ...data, current: { ...data.current, salinity_ppt: null, jellyfish_risk: null } };
  }
}
