import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { PG } from '../../database/database.module';
import { WaterType } from './water-classification';
import { dogFriendlySites } from './dog-access';
import { naturistSites } from './naturism';
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
      const { rows } = await this.db.query(
        `select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id,water_type,water_classification,facility_facts,
          ST_Distance(geom, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000 as "distanceKm"
        from beach_catalogue
        order by geom <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        limit $3`,
        [lat, lon, boundedLimit],
      );
      return rows.map((beach: BeachRow) => this.enrichBeach(beach));
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
    // Keep the correlated lookup inside the page: flattening it aggregates amenities nationwide.
    const { rows } = await this.db.query(
      `select detail.* from (
         select id from beach_catalogue where ($1::uuid is null or id > $1::uuid)
         and lat between $3 and $5 and lon between $4 and $6 order by id limit $2
       ) page cross join lateral (
         select ${catalogueColumns} from beach_catalogue where id=page.id offset 0
       ) detail order by page.id`,
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

  async closedForBathing(): Promise<Set<string>> {
    const {rows} = await this.db.query('select distinct beach_id from active_bathing_restrictions order by beach_id');
    return new Set(rows.map((r:{beach_id:string})=>r.beach_id));
  }

  async searchCandidates(input: SearchInput, commune: Commune | null, at: Date) {
    const params: unknown[] = [];
    const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
    const where: string[] = [];
    const bounds = input.bbox?.split(',').map(Number) ?? commune?.bbox;
    if (bounds) {
      const [south, west, north, east] = bounds.map(bind);
      // Global/polar rectangles are ambiguous as spherical polygons; their numeric bounds remain exact.
      if (bounds[3] - bounds[1] < 180 && bounds[0] > -90 && bounds[2] < 90) {
        where.push(`(geom && ST_MakeEnvelope(${west},${south},${east},${north},4326)::geography or geom is null)`);
      }
      where.push(`lat between ${south} and ${north}`, `lon between ${west} and ${east}`);
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
    if (input.dogAccess) where.push(`osm_id = ANY(${bind(dogFriendlySites(input.dogAccess, at))}::text[])`);
    if (input.naturism) where.push(`osm_id = ANY(${bind(naturistSites(input.naturism, at))}::text[])`);
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

  async discover(bbox:string,limit=140,after?:string) {
    const {beaches,nextCursor}=await this.catalogue(after,limit,bbox);
    return {provider:'local-catalogue',imported:0,beaches,nextCursor,coverage:'partial',
      warning:nextCursor ? 'Résultats paginés : utiliser nextCursor.' : undefined};
  }


  async nearbyAmenities(id: string) {
    return this.amenities.get(id);
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

}
