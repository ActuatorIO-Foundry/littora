import { Injectable } from '@nestjs/common';
import { ForecastStore } from '../../shared/forecast-store';

@Injectable()
export class WeatherService {
  constructor(private readonly store: ForecastStore) {}

  async get(lat: number, lon: number) {
    return process.env.WEATHER_PROVIDER === 'meteofrance'
      ? this.getMeteoFrance(lat, lon) : this.getOpenMeteo(lat, lon);
  }

  getOpenMeteo(lat: number, lon: number) {
    return this.store.get('open-meteo', lat, lon);
  }

  async getMeteoFrance(lat: number, lon: number) {
    const data = await this.getOpenMeteo(lat, lon);
    return {
      ...data, requestedProvider: 'meteofrance',
      warning: [data.warning, 'Direct Meteo-France adapter not connected; actual source is Open-Meteo.'].filter(Boolean).join(' '),
    };
  }
}
