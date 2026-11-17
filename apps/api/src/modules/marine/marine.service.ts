import { Injectable } from '@nestjs/common';
import { ForecastStore } from '../../shared/forecast-store';
import { ForecastData, sources } from '../../shared/forecast-data';
import { forecastUnits } from '../../shared/forecast-units';

export function unavailableMarine(): ForecastData {
  return { provider: 'unknown', kind: 'forecast', status: 'unknown', fetchedAt: null, validAt: null,
    ageSeconds: null, producedAt: null,
    units: Object.fromEntries(marineKeys.map(key => [key, forecastUnits[key].unit])),
    current: Object.fromEntries(['time', ...marineKeys, 'salinity_ppt', 'jellyfish_risk'].map(key => [key, null])),
    warning: 'Marine forecasts require a geographically classified sea beach. Inland water measurements are not connected.' };
}

const marineKeys = sources['open-meteo-marine'].keys;

@Injectable()
export class MarineService {
  constructor(private readonly store: ForecastStore) {}

  async get(lat: number, lon: number): Promise<ForecastData> {
    const data = await this.store.get('open-meteo-marine', lat, lon);
    return { ...data, current: { ...data.current, salinity_ppt: null, jellyfish_risk: null } };
  }
}
