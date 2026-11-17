import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { PG } from '../../database/database.module';
import { haversineKm } from '../../shared/geo';
import { fetchJson, fetchNominatimJson } from '../../shared/http';
import { WaterType } from './water-classification';
import { AmenitiesService } from './amenities.service';
import type { SearchInput } from '../search/search-input';
import type { Commune } from '../places/places.service';

type BeachRow = {
  id: string;
  name: string;
  city: string;
  department: string;
  region: string;
  coastline: string;
  water_type?: WaterType;
  water_classification?: Record<string, unknown> | null;
  facility_facts?: Record<string, any> | null;
  lat: number;
  lon: number;
  has_lifeguard: boolean | null;
  has_parking: boolean | null;
  has_toilets: boolean | null;
  osm_id: string | null;
  distanceKm?: number | null;
  distancekm?: number | null;
};
const catalogueColumns = 'id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id,water_type,water_classification,facility_facts';

@Injectable()
export class BeachesService {
  constructor(
    @Inject(PG) private db: any,
    private cache: CacheService,
    private amenities: AmenitiesService,
  ) {}

  async list(lat?: number, lon?: number, limit = 180) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 180, 1), 500);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      try {
        const { rows } = await this.db.query(
          `select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id,water_type,water_classification,facility_facts,
            ST_Distance(geom, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000 as "distanceKm"
          from beach_catalogue
          order by geom <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          limit $3`,
          [lat, lon, boundedLimit],
        );
        return rows.map((beach: BeachRow) => this.enrichBeach(beach));
      } catch {
        const { rows } = await this.db.query(
          `select ${catalogueColumns} from beach_catalogue order by id limit 500`,
        );
        return rows
          .map((beach: BeachRow) => this.enrichBeach({ ...beach, distanceKm: this.distanceFrom(beach, lat, lon) }))
          .sort((a: BeachRow & { distanceKm: number | null }, b: BeachRow & { distanceKm: number | null }) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999))
          .slice(0, boundedLimit);
      }
    }

    const { rows } = await this.db.query(
      `select ${catalogueColumns} from beach_catalogue order by coastline,name,id limit $1`,
      [boundedLimit],
    );
    return rows.map((beach: BeachRow) => this.enrichBeach({ ...beach, distanceKm: null }));
  }

  async get(id: string) {
    const { rows } = await this.db.query(
      `select ${catalogueColumns} from beach_catalogue where id=$1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Beach not found');
    return this.enrichBeach(rows[0]);
  }

  async catalogue(after?: string, limit = 200, bbox?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new BadRequestException('limit must be an integer between 1 and 500');
    }
    if (after && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(after)) {
      throw new BadRequestException('Invalid catalogue cursor');
    }
    const bounds = bbox ? bbox.split(',').map(Number) : [-90, -180, 90, 180];
    if (bounds.length !== 4 || bounds.some((n) => !Number.isFinite(n)) ||
        bounds[0] < -90 || bounds[2] > 90 || bounds[1] < -180 || bounds[3] > 180 ||
        bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
      throw new BadRequestException('Invalid catalogue bounds');
    }
    // A UUID cursor keeps subsequent pages stable when another beach is deleted.
    const { rows } = await this.db.query(
      `select ${catalogueColumns} from beach_catalogue where ($1::uuid is null or id > $1::uuid)
       and lat between $3 and $5 and lon between $4 and $6
       order by id limit $2`,
      [after || null, limit + 1, ...bounds],
    );
    const page = rows.slice(0, limit);
    return {
      beaches: page.map((beach: BeachRow) => this.enrichBeach({ ...beach, distanceKm: null })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  async inGeometry(contour: unknown) {
    const { rows } = await this.db.query(`select ${catalogueColumns} from beach_catalogue b
      where ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON($1),4326),
        coalesce(b.geom::geometry, ST_SetSRID(ST_MakePoint(b.lon,b.lat),4326))) order by b.name,b.id`, [JSON.stringify(contour)]);
    return rows.map((row: BeachRow) => this.enrichBeach({ ...row, distanceKm: null }));
  }

  async searchCandidates(input: SearchInput, commune: Commune | null) {
    const params: unknown[] = [];
    const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
    const where: string[] = [];
    const bounds = input.bbox?.split(',').map(Number) ?? commune?.bbox;
    if (bounds) {
      const [south, west, north, east] = bounds.map(bind);
      where.push(`(geom && ST_MakeEnvelope(${west},${south},${east},${north},4326)::geography or geom is null)`,
        `lat between ${south} and ${north}`, `lon between ${west} and ${east}`);
    }
    if (commune?.contour) where.push(`ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON(${bind(JSON.stringify(commune.contour))}),4326),ST_SetSRID(ST_MakePoint(lon,lat),4326))`);
    const center = input.lat !== undefined ? {lat:input.lat,lon:input.lon!} : commune?.center ??
      (bounds ? {lat:(bounds[0]+bounds[2])/2,lon:(bounds[1]+bounds[3])/2} : null);
    const point = center ? `ST_SetSRID(ST_MakePoint(${bind(center.lon)},${bind(center.lat)}),4326)::geography` : null;
    const location = 'coalesce(geom,ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography)';
    if (input.radiusKm !== undefined) {
      const radius = bind(input.radiusKm * 1000);
      where.push(`(ST_DWithin(geom,${point},${radius}) or geom is null and ST_DWithin(${location},${point},${radius}))`);
    }
    if (input.waterType) where.push(`water_type=${bind(input.waterType)}`);
    for (const key of ['parking','toilets','rescueStation'] as const) {
      if (input[key]) where.push(`facility_facts->'${key}'->>'value'='true'`);
    }
    if (input.q?.trim() && !commune) where.push(`strpos(lower(concat_ws(' ',name,city,region)),lower(${bind(input.q.trim())}))>0`);
    const { rows } = await this.db.query(`select ${catalogueColumns},
      ${point ? `ST_Distance(${location},${point})/1000` : 'null::double precision'} as "distanceKm"
      from beach_catalogue ${where.length ? `where ${where.join(' and ')}` : ''} order by id`, params);
    return (rows as BeachRow[]).map(row => this.enrichBeach(row));
  }

  async featuresInGeometry(features: Array<{ osmId: string; name: string; city: string; lat: number; lon: number }>, contour: unknown) {
    const { rows } = await this.db.query(`select f.* from jsonb_to_recordset($1::jsonb)
      as f("osmId" text,name text,city text,lat double precision,lon double precision)
      where ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON($2),4326),ST_SetSRID(ST_MakePoint(f.lon,f.lat),4326))`,
      [JSON.stringify(features), JSON.stringify(contour)]);
    return rows as typeof features;
  }

  async discoverFromOpenStreetMap(bbox: string, region: string, coastline: string, limit = 140) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 140, 1), 200);
    const parsedBbox = this.parseBbox(bbox);
    if (process.env.CATALOGUE_DISCOVERY_ENABLED !== 'true') {
      const page = await this.catalogue(undefined, boundedLimit, bbox);
      return { provider: 'local-catalogue', imported: 0, beaches: page.beaches };
    }
    const cacheKey = `osm:beaches:v4:${parsedBbox.join(',')}:${boundedLimit}`;
    const cached = await this.cache.getJson<any[]>(cacheKey);

    try {
      const features = cached ?? (await this.fetchOsmBeaches(parsedBbox, boundedLimit));
      if (!cached) await this.cache.setJson(cacheKey, features, 60 * 60 * 24);

      const imported = [];
      for (const feature of features) {
        const row = await this.upsertDiscoveredBeach(feature, region, coastline);
        if (row) imported.push(row);
      }

      if (imported.length) {
        return {
          provider: cached ? 'openstreetmap-cache' : features[0]?.source === 'nominatim' ? 'openstreetmap-nominatim' : 'openstreetmap-overpass',
          imported: imported.length,
          beaches: imported,
        };
      }
    } catch (error) {
      const fallback = await this.list(parsedBbox[0] + (parsedBbox[2] - parsedBbox[0]) / 2, parsedBbox[1] + (parsedBbox[3] - parsedBbox[1]) / 2, boundedLimit);
      return {
        provider: 'local-db-fallback',
        imported: 0,
        warning: error instanceof Error ? error.message : 'OpenStreetMap discovery unavailable',
        beaches: fallback,
      };
    }

    const fallback = await this.list(parsedBbox[0] + (parsedBbox[2] - parsedBbox[0]) / 2, parsedBbox[1] + (parsedBbox[3] - parsedBbox[1]) / 2, boundedLimit);
    return {
      provider: 'local-db-fallback',
      imported: 0,
      warning: 'No named beaches found from OpenStreetMap in this zone.',
      beaches: fallback,
    };
  }

  distanceFrom(beach: BeachRow, lat?: number, lon?: number) {
    return Number.isFinite(lat) && Number.isFinite(lon) ? haversineKm(lat as number, lon as number, beach.lat, beach.lon) : null;
  }

  async nearbyAmenities(id: string) {
    return this.amenities.get(id);
  }

  private parseBbox(bbox: string) {
    const parsed = bbox.split(',').map((part) => Number(part.trim()));
    if (parsed.length !== 4 || parsed.some((value) => !Number.isFinite(value))) {
      throw new Error('bbox must be "south,west,north,east"');
    }
    return parsed as [number, number, number, number];
  }

  private async fetchOsmBeaches([south, west, north, east]: [number, number, number, number], limit: number) {
    const query = `
      [out:json][timeout:18];
      (
        node["natural"="beach"](${south},${west},${north},${east});
        way["natural"="beach"](${south},${west},${north},${east});
        relation["natural"="beach"](${south},${west},${north},${east});
      );
      out center;
    `;
    const endpoint = process.env.OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter';
    const raw = await fetchJson(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
    });

    const overpassFeatures = (raw.elements ?? [])
      .map((element: any) => this.osmElementToBeach(element))
      .filter(Boolean)
      .slice(0, limit);
    if (overpassFeatures.length) return overpassFeatures;

    return this.fetchNominatimBeaches([south, west, north, east], limit);
  }


  private enrichBeach(beach: BeachRow) {
    const { water_type, water_classification, facility_facts, ...publicBeach } = beach;
    const unknown = { value: null, status: 'unknown', source: 'unknown', verified: false, fetchedAt: null, scope: 'unknown' };
    const facilities = facility_facts ?? { parking: unknown, toilets: unknown, lifeguard: unknown, rescueStation: unknown };
    return {
      ...publicBeach,
      waterType: water_type ?? 'unknown',
      waterClassification: water_classification ?? null,
      facilities,
      has_parking: facilities.parking.value,
      has_toilets: facilities.toilets.value,
      has_lifeguard: facilities.lifeguard.value,
    };
  }

  private osmElementToBeach(element: any) {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const tags = element.tags ?? {};
    if (tags.natural !== 'beach' || tags.amenity || tags.shop || tags.highway) return null;
    const name = tags.name || tags['name:fr'] || tags['official_name'];
    if (!name || String(name).length < 3) return null;

    return {
      osmId: `${element.type}/${element.id}`,
      name: String(name),
      city: tags['addr:city'] || tags['is_in:city'] || tags['addr:municipality'] || null,
      lat,
      lon,
      source: 'overpass',
    };
  }

  private async fetchNominatimBeaches([south, west, north, east]: [number, number, number, number], limit: number) {
    const endpoint = process.env.NOMINATIM_API_URL || 'https://nominatim.openstreetmap.org/search';
    const url = `${endpoint}?format=json&q=plage&bounded=1&viewbox=${west},${north},${east},${south}&limit=${limit}&addressdetails=1`;
    const raw = await fetchNominatimJson(url);

    return (Array.isArray(raw) ? raw : [])
      .map((place: any) => {
        if ((place.category ?? place.class) !== 'natural' || place.type !== 'beach') return null;
        const lat = Number(place.lat);
        const lon = Number(place.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !place.name) return null;
        return {
          osmId: `${place.osm_type}/${place.osm_id}`,
          name: String(place.name),
          city: place.address?.city || place.address?.town || place.address?.village || place.address?.municipality || null,
          lat,
          lon,
          source: 'nominatim',
        };
      })
      .filter(Boolean)
      .slice(0, limit);
  }

  async upsertDiscoveredBeach(feature: { osmId: string; name: string; city?: string | null; lat: number; lon: number }, region: string, coastline: string, department = region) {
    if (!Number.isFinite(feature.lat) || !Number.isFinite(feature.lon) || Math.abs(feature.lat)>90 || Math.abs(feature.lon)>180) return null;
    const eligibility = await this.db.query('select catalogue_in_metropolitan_france($1,$2) as included', [feature.lat,feature.lon]);
    if (eligibility.rows[0]?.included !== true) return null;
    const existing = await this.db.query(
      `select id,catalogue_in_metropolitan_france(lat,lon) as included from beaches where osm_id=$1 limit 1`,
      [feature.osmId],
    );
    if (existing.rows[0]) return existing.rows[0].included ? this.get(existing.rows[0].id) : null;

    const duplicate = await this.db.query(
      `select ${catalogueColumns} from beach_catalogue
       where lower(name)=lower($1)
       and abs(lat - $2) < 0.025
       and abs(lon - $3) < 0.025
       limit 1`,
      [feature.name, feature.lat, feature.lon],
    );
    if (duplicate.rows[0]) return this.enrichBeach({ ...duplicate.rows[0], distanceKm: null });

    const { rows } = await this.db.query(
      `insert into beaches(name,city,department,region,coastline,lat,lon,geom,has_lifeguard,has_parking,has_toilets,osm_id)
       values($1,$2,$3,$4,$5,$6,$7,ST_SetSRID(ST_MakePoint($7,$6),4326)::geography,null,null,null,$8)
       on conflict (osm_id) where osm_id is not null do nothing
       returning id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id`,
      [feature.name, feature.city ?? 'Commune à préciser', department, region, coastline, feature.lat, feature.lon, feature.osmId],
    );
    if (!rows[0]) {
      const concurrent = await this.db.query(`select ${catalogueColumns} from beach_catalogue where osm_id=$1`, [feature.osmId]);
      return concurrent.rows[0] ? this.enrichBeach({ ...concurrent.rows[0], distanceKm: null }) : null;
    }
    return this.get(rows[0].id);
  }

}
