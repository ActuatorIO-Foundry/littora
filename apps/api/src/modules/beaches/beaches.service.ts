import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { PG } from '../../database/database.module';
import { haversineKm } from '../../shared/geo';
import { fetchJson } from '../../shared/http';

type BeachRow = {
  id: string;
  name: string;
  city: string;
  department: string;
  region: string;
  coastline: string;
  water_type?: string;
  lat: number;
  lon: number;
  has_lifeguard: boolean;
  has_parking: boolean;
  has_toilets: boolean;
  osm_id: string | null;
  distanceKm?: number | null;
  distancekm?: number | null;
};

@Injectable()
export class BeachesService {
  constructor(
    @Inject(PG) private db: any,
    private cache: CacheService,
  ) {}

  async list(lat?: number, lon?: number, limit = 180) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 180, 1), 500);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      try {
        const { rows } = await this.db.query(
          `select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id,
            ST_Distance(geom, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000 as "distanceKm"
          from beaches
          order by geom <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          limit $3`,
          [lat, lon, boundedLimit],
        );
        return rows.map((beach: BeachRow) => this.enrichBeach(beach));
      } catch {
        const { rows } = await this.db.query(
          'select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id from beaches limit 500',
        );
        return rows
          .map((beach: BeachRow) => this.enrichBeach({ ...beach, distanceKm: this.distanceFrom(beach, lat, lon) }))
          .sort((a: BeachRow & { distanceKm: number | null }, b: BeachRow & { distanceKm: number | null }) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999))
          .slice(0, boundedLimit);
      }
    }

    const { rows } = await this.db.query(
      'select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id from beaches order by coastline,name limit $1',
      [boundedLimit],
    );
    return rows.map((beach: BeachRow) => this.enrichBeach({ ...beach, distanceKm: null }));
  }

  async get(id: string) {
    const { rows } = await this.db.query(
      'select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id from beaches where id=$1',
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
      `select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id
       from beaches where ($1::uuid is null or id > $1::uuid)
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

  async discoverFromOpenStreetMap(bbox: string, region: string, coastline: string, limit = 140) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 140, 1), 200);
    const parsedBbox = this.parseBbox(bbox);
    const cacheKey = `osm:beaches:v3:${parsedBbox.join(',')}:${boundedLimit}`;
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
    const beach = await this.get(id);
    const cacheKey = `osm:amenities:v4:${id}`;
    const cached = await this.cache.getJson<any>(cacheKey);
    if (cached) return cached;

    try {
      const amenities = await this.fetchNearbyAmenities(beach);
      const response = {
        beachId: id,
        provider: this.amenitiesProvider(amenities),
        radiusMeters: 2500,
        amenities,
      };
      await this.cache.setJson(cacheKey, response, 60 * 60 * 6);
      return response;
    } catch {
      const response = {
        beachId: id,
        provider: 'local-beach-flags-fallback',
        radiusMeters: 2500,
        amenities: this.fallbackAmenities(beach),
      };
      await this.cache.setJson(cacheKey, response, 60 * 20);
      return response;
    }
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
        node["leisure"="beach_resort"](${south},${west},${north},${east});
        way["leisure"="beach_resort"](${south},${west},${north},${east});
        node["name"~"plage",i](${south},${west},${north},${east});
        way["name"~"plage",i](${south},${west},${north},${east});
        relation["name"~"plage",i](${south},${west},${north},${east});
      );
      out center;
    `;
    const endpoint = process.env.OVERPASS_API_URL || 'https://overpass.osm.ch/api/interpreter';
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

  private async fetchNearbyAmenities(beach: BeachRow) {
    const query = `
      [out:json][timeout:18];
      (
        node(around:2500,${beach.lat},${beach.lon})["amenity"~"parking|parking_space|toilets|restaurant|cafe|ice_cream|fast_food|boat_rental"];
        way(around:2500,${beach.lat},${beach.lon})["amenity"~"parking|parking_space|toilets|restaurant|cafe|ice_cream|fast_food|boat_rental"];
        relation(around:2500,${beach.lat},${beach.lon})["amenity"~"parking|parking_space|toilets|restaurant|cafe|ice_cream|fast_food|boat_rental"];
        node(around:2500,${beach.lat},${beach.lon})["parking"];
        way(around:2500,${beach.lat},${beach.lon})["parking"];
        node(around:2500,${beach.lat},${beach.lon})["shop"~"rental|sports|boat|ice_cream|convenience"];
        way(around:2500,${beach.lat},${beach.lon})["shop"~"rental|sports|boat|ice_cream|convenience"];
        node(around:2500,${beach.lat},${beach.lon})["sport"~"canoe|paddle|surf|sailing|diving|swimming"];
        way(around:2500,${beach.lat},${beach.lon})["sport"~"canoe|paddle|surf|sailing|diving|swimming"];
        node(around:2500,${beach.lat},${beach.lon})["leisure"~"marina|sports_centre|water_park"];
        way(around:2500,${beach.lat},${beach.lon})["leisure"~"marina|sports_centre|water_park"];
        node(around:1800,${beach.lat},${beach.lon})["emergency"~"lifeguard|rescue_station"];
        way(around:1800,${beach.lat},${beach.lon})["emergency"~"lifeguard|rescue_station"];
      );
      out center tags;
    `;
    const endpoint = process.env.OVERPASS_API_URL || 'https://overpass.osm.ch/api/interpreter';
    const raw = await fetchJson(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
    });

    const amenities = (raw.elements ?? [])
      .map((element: any) => this.osmElementToAmenity(element, beach))
      .filter(Boolean)
      .filter((amenity: any, index: number, all: any[]) => all.findIndex((item) => item.category === amenity.category && item.name === amenity.name && Math.abs(item.lat - amenity.lat) < 0.0004 && Math.abs(item.lon - amenity.lon) < 0.0004) === index)
      .sort((a: any, b: any) => a.distanceKm - b.distanceKm)
      .slice(0, 36);
    if (amenities.length) return this.completeAmenities(beach, amenities);

    const nominatim = await this.fetchNominatimAmenities(beach);
    return nominatim.length ? this.completeAmenities(beach, nominatim) : this.fallbackAmenities(beach);
  }

  private async fetchNominatimAmenities(beach: BeachRow) {
    const endpoint = process.env.NOMINATIM_API_URL || 'https://nominatim.openstreetmap.org/search';
    const delta = 0.035;
    const viewbox = `${beach.lon - delta},${beach.lat + delta},${beach.lon + delta},${beach.lat - delta}`;
    const searches = [
      { q: 'parking', category: 'parking' },
      { q: 'toilettes publiques', category: 'toilets' },
      { q: 'poste de secours plage', category: 'rescue' },
      { q: 'location paddle kayak bateau', category: 'rental' },
      { q: 'restaurant cafe glacier', category: 'food' },
    ];
    const amenities: any[] = [];

    for (const search of searches) {
      try {
        const url = `${endpoint}?format=json&q=${encodeURIComponent(search.q)}&bounded=1&viewbox=${viewbox}&limit=8&addressdetails=0`;
        const raw = await fetchJson(url, {
          headers: {
            'user-agent': 'LittoraLocal/0.1 (development nearby amenities)',
            accept: 'application/json',
          },
        });
        for (const place of raw ?? []) {
          const lat = Number(place.lat);
          const lon = Number(place.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          amenities.push({
            id: `nominatim/${place.osm_type}/${place.osm_id}`,
            name: place.name || place.display_name?.split(',')[0] || this.amenityFallbackName(search.category),
            category: search.category,
            lat,
            lon,
            distanceKm: Math.round(haversineKm(beach.lat, beach.lon, lat, lon) * 10) / 10,
            source: 'openstreetmap-nominatim',
          });
        }
      } catch {
        // Keep the amenity response resilient; other searches may still work.
      }
    }

    return amenities
      .filter((amenity, index, all) => all.findIndex((item) => item.category === amenity.category && item.name === amenity.name) === index)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 36);
  }

  private osmElementToAmenity(element: any, beach: BeachRow) {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const tags = element.tags ?? {};
    const category = this.amenityCategory(tags);
    return {
      id: `${element.type}/${element.id}`,
      name: tags.name || this.amenityFallbackName(category),
      category,
      lat,
      lon,
      distanceKm: Math.round(haversineKm(beach.lat, beach.lon, lat, lon) * 10) / 10,
      source: 'openstreetmap',
    };
  }

  private amenityCategory(tags: Record<string, string>) {
    if (tags.amenity === 'parking' || tags.amenity === 'parking_space' || tags.parking) return 'parking';
    if (tags.amenity === 'toilets') return 'toilets';
    if (tags.emergency || tags.lifeguard) return 'rescue';
    if (tags.shop === 'ice_cream' || ['restaurant', 'cafe', 'ice_cream', 'fast_food'].includes(tags.amenity)) return 'food';
    if (tags.shop || tags.sport || tags.leisure === 'marina' || tags.leisure === 'sports_centre') return 'rental';
    return 'other';
  }

  private amenityFallbackName(category: string) {
    const labels: Record<string, string> = {
      parking: 'Parking',
      toilets: 'Toilettes publiques',
      rental: 'Location ou activité nautique',
      food: 'Restauration',
      rescue: 'Poste de secours',
      other: 'Service proche',
    };
    return labels[category] ?? 'Service proche';
  }

  private fallbackAmenities(beach: BeachRow) {
    const amenities: Array<Record<string, unknown>> = [];
    const add = (category: string, name: string, distanceKm: number, source: string, offsetLat = 0, offsetLon = 0) => {
      amenities.push({
        id: `${beach.id}:${category}:${source}:${amenities.length}`,
        name,
        category,
        lat: Number((beach.lat + offsetLat).toFixed(6)),
        lon: Number((beach.lon + offsetLon).toFixed(6)),
        distanceKm,
        source,
        verification: source === 'local-hint' ? 'to_verify' : 'listed',
      });
    };

    if (beach.has_parking) add('parking', 'Parking indiqué sur la fiche plage', 0, 'local-db');
    if (beach.has_toilets) add('toilets', 'Toilettes indiquées sur la fiche plage', 0, 'local-db');
    if (beach.has_lifeguard) add('rescue', 'Surveillance indiquée sur la fiche plage', 0, 'local-db');

    if (!amenities.some((amenity) => amenity.category === 'parking')) {
      add('parking', 'Stationnement proche à vérifier', 0.4, 'local-hint', 0.0022, 0.0022);
    }
    if (!amenities.some((amenity) => amenity.category === 'toilets')) {
      add('toilets', 'Sanitaires publics à confirmer', 0.3, 'local-hint', -0.0018, 0.0016);
    }
    if (!amenities.some((amenity) => amenity.category === 'rescue')) {
      add('rescue', 'Poste de secours ou surveillance saisonnière à confirmer', 0.5, 'local-hint', 0.0024, -0.0018);
    }

    add('rental', 'Location nautique saisonnière à vérifier', 0.8, 'local-hint', -0.003, -0.002);
    add('food', 'Restauration ou glacier proche à vérifier', 0.7, 'local-hint', 0.0016, -0.003);
    return amenities;
  }

  private completeAmenities(beach: BeachRow, amenities: any[]) {
    const completed = [...amenities];
    for (const hint of this.fallbackAmenities(beach)) {
      if (!completed.some((amenity) => amenity.category === hint.category)) {
        completed.push(hint);
      }
    }

    return completed
      .sort((a, b) => Number(a.distanceKm ?? 999) - Number(b.distanceKm ?? 999))
      .slice(0, 36);
  }

  private amenitiesProvider(amenities: Array<Record<string, unknown>>) {
    if (amenities.some((amenity) => amenity.source === 'openstreetmap')) return 'openstreetmap-overpass';
    if (amenities.some((amenity) => amenity.source === 'openstreetmap-nominatim')) return 'openstreetmap-nominatim';
    if (amenities.some((amenity) => amenity.source === 'local-db')) return 'local-beach-flags-fallback';
    return 'local-beach-hints';
  }

  private enrichBeach(beach: BeachRow) {
    return {
      ...beach,
      waterType: this.deriveWaterType(beach),
    };
  }

  private deriveWaterType(beach: BeachRow): 'sea' | 'river' | 'lake' | 'unknown' {
    const text = `${beach.name} ${beach.city} ${beach.department} ${beach.region} ${beach.coastline}`.toLowerCase();
    if (/(lac|étang|etang|apigné|apigne|base nautique|plan d'eau|plan d’eau|réservoir|reservoir)/.test(text)) return 'lake';
    if (/(rivière|riviere|fleuve|gorge|verdon|tarn|loire|dordogne|garonne|allier|ardèche|ardeche)/.test(text)) return 'river';
    if (/(méditerranée|mediterranee|atlantique|manche|corse|opale|côte|cote|littoral|plage de mer)/.test(text)) return 'sea';
    return 'unknown';
  }

  private osmElementToBeach(element: any) {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const tags = element.tags ?? {};
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
    const raw = await fetchJson(url, {
      headers: {
        'user-agent': 'LittoraLocal/0.1 (development beach discovery)',
        accept: 'application/json',
      },
    });

    return (raw ?? [])
      .map((place: any) => {
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

  private async upsertDiscoveredBeach(feature: { osmId: string; name: string; city?: string | null; lat: number; lon: number }, region: string, coastline: string) {
    const existing = await this.db.query(
      'select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id from beaches where osm_id=$1 limit 1',
      [feature.osmId],
    );
    if (existing.rows[0]) return this.enrichBeach({ ...existing.rows[0], distanceKm: null });

    const duplicate = await this.db.query(
      `select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id
       from beaches
       where lower(name)=lower($1)
       and abs(lat - $2) < 0.025
       and abs(lon - $3) < 0.025
       limit 1`,
      [feature.name, feature.lat, feature.lon],
    );
    if (duplicate.rows[0]) return this.enrichBeach({ ...duplicate.rows[0], distanceKm: null });

    const { rows } = await this.db.query(
      `insert into beaches(name,city,department,region,coastline,lat,lon,geom,has_lifeguard,has_parking,has_toilets,osm_id)
       values($1,$2,$3,$4,$5,$6,$7,ST_SetSRID(ST_MakePoint($7,$6),4326)::geography,false,false,false,$8)
       returning id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id`,
      [feature.name, feature.city ?? 'Commune à préciser', region, region, coastline, feature.lat, feature.lon, feature.osmId],
    );
    return this.enrichBeach({ ...rows[0], distanceKm: null });
  }

}
