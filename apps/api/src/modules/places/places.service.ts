import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { BeachesService } from '../beaches/beaches.service';

type Outline = { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown[] };
export type Commune = {
  code: string; name: string;
  department: { code: string; name: string };
  region: { code: string; name: string };
  center: { lat: number; lon: number };
  bbox: [number, number, number, number];
  contour?: Outline;
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

@Injectable()
export class PlacesService {
  constructor(private readonly cache: CacheService, private readonly beaches: BeachesService) {}

  async search(query: string): Promise<Commune[]> {
    if (typeof query !== 'string') throw new BadRequestException('Invalid commune query');
    const name = (query ?? '').trim();
    if (name.length < 2) return [];
    if (name.length > 80) throw new BadRequestException('Commune query too long');
    const key = `geo:communes:v1:${name.toLocaleLowerCase('fr')}`;
    const cached = await this.cache.getJson<Commune[]>(key);
    if (cached) return cached;
    const url = new URL('https://geo.api.gouv.fr/communes');
    url.search = new URLSearchParams({ nom: name, fields: 'nom,code,centre,bbox,departement,region', limit: '8', boost: 'population' }).toString();
    const raw = await this.json(url);
    if (!Array.isArray(raw)) throw new ServiceUnavailableException('Invalid commune response');
    const communes = raw.map(value => this.normalize(value)).filter((value): value is Commune => value !== null);
    await this.cache.setJson(key, communes, 86400);
    return communes;
  }

  async get(code: string): Promise<Commune & { contour: Outline }> {
    if (!/^(?:\d{2}|2[AB])\d{3}$/.test(code)) throw new BadRequestException('Invalid INSEE code');
    const key = `geo:commune:v1:${code}`;
    const cached = await this.cache.getJson<Commune & { contour: Outline }>(key);
    if (cached) return cached;
    const url = new URL(`https://geo.api.gouv.fr/communes/${code}`);
    url.searchParams.set('fields', 'nom,code,centre,bbox,departement,region,contour');
    const raw = await this.json(url);
    const commune = this.normalize(raw);
    const contour = object(object(raw).contour);
    if (!commune || commune.code !== code) throw new NotFoundException('Commune not found in metropolitan France');
    if (!['Polygon', 'MultiPolygon'].includes(String(contour.type)) || !Array.isArray(contour.coordinates)) {
      throw new ServiceUnavailableException('Commune boundary unavailable');
    }
    const values = contour.coordinates.flat(Infinity);
    if (!values.length || values.length > 400000 || values.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
      throw new ServiceUnavailableException('Invalid commune boundary');
    }
    const result = { ...commune, contour: contour as Outline };
    await this.cache.setJson(key, result, 86400 * 7);
    return result;
  }

  async catalogue(code: string) {
    const commune = await this.get(code);
    return {commune,beaches:await this.beaches.inGeometry(commune.contour),source:'local-catalogue',
      collectedAt:null,coverage:'partial' as const,capped:false,
      warning:'Catalogue local uniquement, couverture partielle.'};
  }

  private normalize(value: unknown): Commune | null {
    const row = object(value), center = object(row.centre), department = object(row.departement), region = object(row.region);
    const coordinates = center.coordinates;
    const ring = object(row.bbox).coordinates;
    if (typeof row.nom !== 'string' || typeof row.code !== 'string' || !Array.isArray(coordinates) ||
        !Array.isArray(ring) || !Array.isArray(ring[0])) return null;
    const [lon, lat] = coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -5.5 || lon > 10 || lat < 41.2 || lat > 51.2) return null;
    const points = ring[0];
    if (!points.length || points.some(p => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    return { code: row.code, name: row.nom, center: { lat, lon },
      department: { code: String(department.code ?? ''), name: String(department.nom ?? '') },
      region: { code: String(region.code ?? ''), name: String(region.nom ?? '') },
      bbox: [Math.min(...ys), Math.min(...xs), Math.max(...ys), Math.max(...xs)] };
  }

  private async json(url: URL): Promise<unknown> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000),
        headers: { accept: 'application/json', 'user-agent': 'Littora/0.1 (+https://github.com/ActuatorIO-Foundry/littora)' } });
      if (!response.ok) throw new Error('Provider unavailable');
      const body = await response.text();
      if (body.length > 8 * 1024 * 1024) throw new Error('Provider response too large');
      return JSON.parse(body);
    } catch { throw new ServiceUnavailableException('Geographic source unavailable'); }
  }
}
