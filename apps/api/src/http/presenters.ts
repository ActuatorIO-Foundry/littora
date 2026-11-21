import { ForecastData, finiteMetric } from '../shared/forecast-data';
import { modelVersion } from '../modules/score/comfort-model';
import { dogAccess } from '../modules/beaches/dog-access';

type Row = Record<string, any>;
const date = (value: unknown): string | null => {
  const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

export function measurement(value: unknown, unit: string | undefined, data: Partial<ForecastData>, validAt = data.validAt) {
  const number = finiteMetric(value);
  return {
    value: number, unit: unit ?? null,
    source: { provider: data.provider ?? 'unknown', product: null },
    kind: 'forecast' as const,
    status: number === null ? 'unknown' : data.status === 'stale' ? 'stale' : 'available',
    fetchedAt: date(data.fetchedAt), validAt: date(validAt), validUntil: null,
    producedAt: date(data.producedAt), resolution: { spatialMeters: null, temporalSeconds: null }, isDemo: false,
  };
}
const measurements = (current: Row, data: Partial<ForecastData>) => Object.fromEntries(
  Object.entries(data.units ?? {}).map(([key, unit]) => [key, measurement(current[key], unit, data)]),
);
export const presentForecast = (data: ForecastData) => ({ ...data, isDemo: false, measurements: measurements(data.current, data) });

export function presentBeach(beach: Row) {
  return presentBeachAt(beach, new Date());
}
function presentBeachAt(beach: Row, at: Date) {
  const presence = (value: unknown) => ({
    value: typeof value === 'boolean' ? value : null,
    status: value === true ? 'present' : value === false ? 'absent' : 'unknown',
    source: 'legacy-catalogue', verified: false, fetchedAt: null,
  });
  return { ...beach, city: beach.city ?? null, department: beach.department ?? null,
    region: beach.region ?? null, coastline: beach.coastline ?? null, osm_id: beach.osm_id ?? null,
    distanceKm: beach.distanceKm ?? null,
    dogAccess: dogAccess(beach.osm_id, at),
    has_lifeguard: beach.has_lifeguard ?? null, has_parking: beach.has_parking ?? null, has_toilets: beach.has_toilets ?? null,
    facilities: beach.facilities ?? { lifeguard: presence(beach.has_lifeguard), parking: presence(beach.has_parking), toilets: presence(beach.has_toilets) },
  };
}
export function presentScore(score: Row) {
  const { estimatedFlag, ...safety } = score.safety;
  const levels: Record<string, string> = { green: 'favorable', yellow: 'caution', red: 'unfavorable', unknown: 'unknown' };
  const metrics: Record<string, [string, string]> = {
    uv: ['weather', 'uv_index'], air: ['weather', 'temperature_2m'], water: ['marine', 'sea_surface_temperature'],
    wave: ['marine', 'wave_height'], current: ['marine', 'ocean_current_velocity'],
  };
  return { ...score, beach: presentBeach(score.beach),
    current: { ...score.current, waterQuality: { ...score.current.waterQuality, isDemo: false } },
    safety: { ...safety, officialFlag: { value: null, status: 'unknown', source: null, validAt: null },
      calculatedConditions: { level: levels[estimatedFlag] ?? 'unknown', source: modelVersion } },
    measurements: {
      weather: measurements(score.current.weather, score.dataStatus.weather),
      marine: measurements(score.current.marine, score.dataStatus.marine),
      forecast: Object.fromEntries(Object.entries(metrics).map(([series, [group, key]]) => [series,
        (score.forecast[series] ?? []).map((point: Row) => measurement(point.value, score.dataStatus[group].units[key], score.dataStatus[group], point.time)),
      ])),
    },
  };
}
export const presentReport = (row: Row) => ({ id:row.id,beach_id:row.beach_id,type:row.type,value:row.value,
  status:row.status,created_at:row.created_at,observed_at:date(row.observed_at),expires_at:date(row.expires_at),
  confidence: row.confidence == null ? null : Number(row.confidence),
  provenance: { kind: 'contribution', source: 'littora-reports',
    isDemo: row.is_demo === true || row.value?.demo === true || row.value?.demo === 'true', verified: row.status === 'verified' },
});

export function present(operation: string, data: any, query: Row): unknown {
  switch (operation) {
    case 'searchBeaches': {
      const at = new Date(data.asOf);
      return { ...data, items: data.items.map((beach: Row) => presentBeachAt(beach, at)) };
    }
    case 'listBeaches': case 'getRecommendations': return data.map(presentBeach);
    case 'getBeach': return presentBeach(data);
    case 'getBeachAmenities': return { ...data, amenities: data.amenities.map((amenity: Row) => ({
      ...amenity, verification: amenity.verification ??
        (['openstreetmap', 'openstreetmap-nominatim'].includes(amenity.source) ? 'listed' : 'to_verify'),
    })) };
    case 'getCatalogue': {
      const items = data.beaches.map(presentBeach);
      return { beaches: items, nextCursor: data.nextCursor, items,
        pageInfo: { nextCursor: data.nextCursor, hasNextPage: data.nextCursor !== null, limit: Number(query.limit ?? 200) } };
    }
    case 'getCommuneCatalogue': case 'discoverBeaches': return { ...data, beaches: data.beaches.map(presentBeach) };
    case 'getBeachScore': return presentScore(data);
    case 'getWeather': case 'getMarine': return presentForecast(data);
    case 'getWaterQuality': return { ...data, isDemo: false };
    case 'createReport': return presentReport(data);
    case 'getReports': return data.map(presentReport);
    default: return data;
  }
}
