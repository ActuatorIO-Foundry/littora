import { Injectable } from '@nestjs/common';

export function unavailableTides() {
  return { provider: 'unknown', status: 'unknown', reliability: 'unknown', fetchedAt: null,
    validAt: null, ageSeconds: null, harbor: null, events: [],
    warning: 'Tide data requires a geographically classified sea beach.' };
}

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
