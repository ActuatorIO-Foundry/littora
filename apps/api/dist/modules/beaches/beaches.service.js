"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BeachesService = void 0;
const common_1 = require("@nestjs/common");
const cache_service_1 = require("../../cache/cache.service");
const database_module_1 = require("../../database/database.module");
const geo_1 = require("../../shared/geo");
const http_1 = require("../../shared/http");
let BeachesService = class BeachesService {
    constructor(db, cache) {
        this.db = db;
        this.cache = cache;
    }
    async list(lat, lon, limit = 180) {
        const boundedLimit = Math.min(Math.max(Number(limit) || 180, 1), 500);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            try {
                const { rows } = await this.db.query(`select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id,
            ST_Distance(geom, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000 as "distanceKm"
          from beaches
          order by geom <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          limit $3`, [lat, lon, boundedLimit]);
                return rows;
            }
            catch {
                const { rows } = await this.db.query('select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id from beaches limit 500');
                return rows
                    .map((beach) => ({ ...beach, distanceKm: this.distanceFrom(beach, lat, lon) }))
                    .sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999))
                    .slice(0, boundedLimit);
            }
        }
        const { rows } = await this.db.query('select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id from beaches order by coastline,name limit $1', [boundedLimit]);
        return rows.map((beach) => ({ ...beach, distanceKm: null }));
    }
    async get(id) {
        const { rows } = await this.db.query('select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id from beaches where id=$1', [id]);
        if (!rows[0])
            throw new common_1.NotFoundException('Beach not found');
        return rows[0];
    }
    async discoverFromOpenStreetMap(bbox, region, coastline, limit = 140) {
        await this.ensureGeoSchema();
        const boundedLimit = Math.min(Math.max(Number(limit) || 140, 1), 200);
        const parsedBbox = this.parseBbox(bbox);
        const cacheKey = `osm:beaches:v3:${parsedBbox.join(',')}:${boundedLimit}`;
        const cached = await this.cache.getJson(cacheKey);
        try {
            const features = cached ?? (await this.fetchOsmBeaches(parsedBbox, boundedLimit));
            if (!cached)
                await this.cache.setJson(cacheKey, features, 60 * 60 * 24);
            const imported = [];
            for (const feature of features) {
                const row = await this.upsertDiscoveredBeach(feature, region, coastline);
                if (row)
                    imported.push(row);
            }
            if (imported.length) {
                return {
                    provider: cached ? 'openstreetmap-cache' : features[0]?.source === 'nominatim' ? 'openstreetmap-nominatim' : 'openstreetmap-overpass',
                    imported: imported.length,
                    beaches: imported,
                };
            }
        }
        catch (error) {
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
    distanceFrom(beach, lat, lon) {
        return Number.isFinite(lat) && Number.isFinite(lon) ? (0, geo_1.haversineKm)(lat, lon, beach.lat, beach.lon) : null;
    }
    async nearbyAmenities(id) {
        const beach = await this.get(id);
        const cacheKey = `osm:amenities:v1:${id}`;
        const cached = await this.cache.getJson(cacheKey);
        if (cached)
            return cached;
        try {
            const amenities = await this.fetchNearbyAmenities(beach);
            const response = {
                beachId: id,
                provider: 'openstreetmap-overpass',
                radiusMeters: 1400,
                amenities,
            };
            await this.cache.setJson(cacheKey, response, 60 * 60 * 6);
            return response;
        }
        catch {
            const response = {
                beachId: id,
                provider: 'local-beach-flags-fallback',
                radiusMeters: 1400,
                amenities: this.fallbackAmenities(beach),
            };
            await this.cache.setJson(cacheKey, response, 60 * 20);
            return response;
        }
    }
    parseBbox(bbox) {
        const parsed = bbox.split(',').map((part) => Number(part.trim()));
        if (parsed.length !== 4 || parsed.some((value) => !Number.isFinite(value))) {
            throw new Error('bbox must be "south,west,north,east"');
        }
        return parsed;
    }
    async fetchOsmBeaches([south, west, north, east], limit) {
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
        const raw = await (0, http_1.fetchJson)(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ data: query }),
        });
        const overpassFeatures = (raw.elements ?? [])
            .map((element) => this.osmElementToBeach(element))
            .filter(Boolean)
            .slice(0, limit);
        if (overpassFeatures.length)
            return overpassFeatures;
        return this.fetchNominatimBeaches([south, west, north, east], limit);
    }
    async fetchNearbyAmenities(beach) {
        const query = `
      [out:json][timeout:18];
      (
        node(around:1400,${beach.lat},${beach.lon})["amenity"="parking"];
        way(around:1400,${beach.lat},${beach.lon})["amenity"="parking"];
        node(around:1100,${beach.lat},${beach.lon})["amenity"="toilets"];
        way(around:1100,${beach.lat},${beach.lon})["amenity"="toilets"];
        node(around:1400,${beach.lat},${beach.lon})["amenity"~"restaurant|cafe|ice_cream|fast_food"];
        way(around:1400,${beach.lat},${beach.lon})["amenity"~"restaurant|cafe|ice_cream|fast_food"];
        node(around:1600,${beach.lat},${beach.lon})["shop"~"rental|sports|boat|ice_cream"];
        way(around:1600,${beach.lat},${beach.lon})["shop"~"rental|sports|boat|ice_cream"];
        node(around:1600,${beach.lat},${beach.lon})["sport"~"canoe|paddle|surf|sailing|diving"];
        way(around:1600,${beach.lat},${beach.lon})["sport"~"canoe|paddle|surf|sailing|diving"];
        node(around:1600,${beach.lat},${beach.lon})["leisure"~"marina|sports_centre"];
        way(around:1600,${beach.lat},${beach.lon})["leisure"~"marina|sports_centre"];
        node(around:1000,${beach.lat},${beach.lon})["emergency"~"lifeguard|rescue_station"];
        way(around:1000,${beach.lat},${beach.lon})["emergency"~"lifeguard|rescue_station"];
      );
      out center tags;
    `;
        const endpoint = process.env.OVERPASS_API_URL || 'https://overpass.osm.ch/api/interpreter';
        const raw = await (0, http_1.fetchJson)(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ data: query }),
        });
        return (raw.elements ?? [])
            .map((element) => this.osmElementToAmenity(element, beach))
            .filter(Boolean)
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, 36);
    }
    osmElementToAmenity(element, beach) {
        const lat = element.lat ?? element.center?.lat;
        const lon = element.lon ?? element.center?.lon;
        if (!Number.isFinite(lat) || !Number.isFinite(lon))
            return null;
        const tags = element.tags ?? {};
        const category = this.amenityCategory(tags);
        return {
            id: `${element.type}/${element.id}`,
            name: tags.name || this.amenityFallbackName(category),
            category,
            lat,
            lon,
            distanceKm: Math.round((0, geo_1.haversineKm)(beach.lat, beach.lon, lat, lon) * 10) / 10,
            source: 'openstreetmap',
        };
    }
    amenityCategory(tags) {
        if (tags.amenity === 'parking')
            return 'parking';
        if (tags.amenity === 'toilets')
            return 'toilets';
        if (tags.emergency || tags.lifeguard)
            return 'rescue';
        if (tags.shop === 'ice_cream' || ['restaurant', 'cafe', 'ice_cream', 'fast_food'].includes(tags.amenity))
            return 'food';
        if (tags.shop || tags.sport || tags.leisure === 'marina' || tags.leisure === 'sports_centre')
            return 'rental';
        return 'other';
    }
    amenityFallbackName(category) {
        const labels = {
            parking: 'Parking',
            toilets: 'Toilettes publiques',
            rental: 'Location ou activité nautique',
            food: 'Restauration',
            rescue: 'Poste de secours',
            other: 'Service proche',
        };
        return labels[category] ?? 'Service proche';
    }
    fallbackAmenities(beach) {
        const amenities = [];
        if (beach.has_parking)
            amenities.push({ id: `${beach.id}:parking`, name: 'Parking indiqué sur la fiche plage', category: 'parking', lat: beach.lat, lon: beach.lon, distanceKm: 0, source: 'local-db' });
        if (beach.has_toilets)
            amenities.push({ id: `${beach.id}:toilets`, name: 'Toilettes indiquées sur la fiche plage', category: 'toilets', lat: beach.lat, lon: beach.lon, distanceKm: 0, source: 'local-db' });
        if (beach.has_lifeguard)
            amenities.push({ id: `${beach.id}:rescue`, name: 'Surveillance indiquée sur la fiche plage', category: 'rescue', lat: beach.lat, lon: beach.lon, distanceKm: 0, source: 'local-db' });
        return amenities;
    }
    osmElementToBeach(element) {
        const lat = element.lat ?? element.center?.lat;
        const lon = element.lon ?? element.center?.lon;
        if (!Number.isFinite(lat) || !Number.isFinite(lon))
            return null;
        const tags = element.tags ?? {};
        const name = tags.name || tags['name:fr'] || tags['official_name'];
        if (!name || String(name).length < 3)
            return null;
        return {
            osmId: `${element.type}/${element.id}`,
            name: String(name),
            city: tags['addr:city'] || tags['is_in:city'] || tags['addr:municipality'] || null,
            lat,
            lon,
            source: 'overpass',
        };
    }
    async fetchNominatimBeaches([south, west, north, east], limit) {
        const endpoint = process.env.NOMINATIM_API_URL || 'https://nominatim.openstreetmap.org/search';
        const url = `${endpoint}?format=json&q=plage&bounded=1&viewbox=${west},${north},${east},${south}&limit=${limit}&addressdetails=1`;
        const raw = await (0, http_1.fetchJson)(url, {
            headers: {
                'user-agent': 'LittoraLocal/0.1 (development beach discovery)',
                accept: 'application/json',
            },
        });
        return (raw ?? [])
            .map((place) => {
            const lat = Number(place.lat);
            const lon = Number(place.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon) || !place.name)
                return null;
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
    async upsertDiscoveredBeach(feature, region, coastline) {
        const existing = await this.db.query('select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id from beaches where osm_id=$1 limit 1', [feature.osmId]);
        if (existing.rows[0])
            return { ...existing.rows[0], distanceKm: null };
        const duplicate = await this.db.query(`select id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id
       from beaches
       where lower(name)=lower($1)
       and abs(lat - $2) < 0.025
       and abs(lon - $3) < 0.025
       limit 1`, [feature.name, feature.lat, feature.lon]);
        if (duplicate.rows[0])
            return { ...duplicate.rows[0], distanceKm: null };
        const { rows } = await this.db.query(`insert into beaches(name,city,department,region,coastline,lat,lon,geom,has_lifeguard,has_parking,has_toilets,osm_id)
       values($1,$2,$3,$4,$5,$6,$7,ST_SetSRID(ST_MakePoint($7,$6),4326)::geography,false,false,false,$8)
       returning id,name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets,osm_id`, [feature.name, feature.city ?? 'Commune à préciser', region, region, coastline, feature.lat, feature.lon, feature.osmId]);
        return { ...rows[0], distanceKm: null };
    }
    async ensureGeoSchema() {
        try {
            await this.db.query('create extension if not exists postgis');
            await this.db.query('alter table beaches add column if not exists geom geography(Point,4326)');
            await this.db.query('update beaches set geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography where geom is null');
            await this.db.query('create index if not exists beaches_geom_idx on beaches using gist(geom)');
            await this.db.query('create unique index if not exists beaches_osm_id_unique_idx on beaches(osm_id) where osm_id is not null');
        }
        catch {
        }
    }
};
exports.BeachesService = BeachesService;
exports.BeachesService = BeachesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.PG)),
    __metadata("design:paramtypes", [Object, cache_service_1.CacheService])
], BeachesService);
//# sourceMappingURL=beaches.service.js.map