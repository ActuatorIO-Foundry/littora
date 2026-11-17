import { Injectable } from '@nestjs/common';

@Injectable()
export class TidesService {
  async get(lat: number, lon: number, harbor?: string) {
    return {
      provider: 'shom', status: 'unknown', reliability: 'unknown',
      fetchedAt: null, validAt: null, ageSeconds: null,
      warning: 'SHOM tide adapter not connected. No local tide estimate is published.',
      harbor: harbor ?? null, events: [],
    };
  }
}
