import { BadRequestException } from '@nestjs/common';
import type { DogAccessFilter } from '../beaches/dog-access';
import type { NaturismFilter } from '../beaches/naturism';

export type SearchInput = {
  q?: string; bbox?: string; communeCode?: string;
  lat?: number; lon?: number; radiusKm?: number;
  waterType?: 'sea' | 'lake' | 'river' | 'unknown';
  parking?: boolean; toilets?: boolean; rescueStation?: boolean;
  dogAccess?: DogAccessFilter;
  naturism?: NaturismFilter;
  flag?: 'green' | 'yellow' | 'red';
  minWaterTemp?: number; maxWaterTemp?: number;
  minAirTemp?: number; maxAirTemp?: number; minScore?: number;
  usage?: 'bathing' | 'family' | 'paddle' | 'boat';
  sort?: 'name' | 'distance' | 'score'; limit?: number; cursor?: string;
};

export function validateSearch(input: SearchInput) {
  const fail = () => { throw new BadRequestException('Invalid search criteria'); };
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200)) fail();
  const hasPosition = input.lat !== undefined || input.lon !== undefined || input.radiusKm !== undefined;
  if (Number(!!input.bbox) + Number(!!input.communeCode) + Number(hasPosition) > 1) fail();
  if (hasPosition && (!Number.isFinite(input.lat) || !Number.isFinite(input.lon) ||
      Math.abs(input.lat!) > 90 || Math.abs(input.lon!) > 180 ||
      !Number.isFinite(input.radiusKm) || input.radiusKm! <= 0 || input.radiusKm! > 200)) fail();
  for (const [min, max] of [[input.minWaterTemp, input.maxWaterTemp], [input.minAirTemp, input.maxAirTemp]]) {
    if (min !== undefined && max !== undefined && min > max) fail();
  }
  if (input.bbox) {
    const b = input.bbox.split(',').map(Number);
    if (b.length !== 4 || b.some(n => !Number.isFinite(n)) || b[0] < -90 || b[2] > 90 ||
        b[1] < -180 || b[3] > 180 || b[0] >= b[2] || b[1] >= b[3]) fail();
  }
  if (input.sort === 'distance' && !hasPosition && !input.communeCode && !input.bbox) fail();
}
