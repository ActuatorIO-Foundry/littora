export interface Beach {
  id: string;
  name: string;
  city: string;
  department: string;
  region: string;
  coastline: string;
  waterType?: 'sea' | 'river' | 'lake' | 'unknown';
  lat: number;
  lon: number;
  has_lifeguard: boolean | null;
  has_parking: boolean | null;
  has_toilets: boolean | null;
  facilities?: import('@littora/api-client/models').Beach['facilities'];
  osm_id: string | null;
  dogAccess?: import('@littora/api-client/models').DogAccess;
  naturism?: import('@littora/api-client/models').Naturism;
  officialFlagBulletin?: import('@littora/api-client/models').OfficialFlagBulletin;
  distanceKm: number | null;
}

export interface BeachScore {
  explanations?: import('@littora/api-client/models').UsageExplanations;
  beach: Beach;
  current?: {
    weather?: Record<string, unknown>;
    marine?: Record<string, unknown>;
    tides?: import('@littora/api-client/models').Tides;
    waterQuality?: import('@littora/api-client/models').WaterQuality;
  };
  scores: {
    bathing: number | null;
    family: number | null;
    paddle: number | null;
    boat: number | null;
  };
  summary?: {
    bathing?: string;
    family?: string;
    paddle?: string;
    boat?: string;
  };
  safety?: {
    flag: 'green' | 'yellow' | 'red' | 'unknown';
    alerts: string[];
    source?: string;
    official?: boolean;
    communityFlag?: {
      flag: 'green' | 'yellow' | 'red' | null;
      confidence: number;
      agreement?: number | null;
      participants?: number;
      status?: 'insufficient' | 'consensus' | 'conflicting' | 'capped';
      recentRedAt?: string | null;
      counts: Record<string, number>;
      history: Array<{ reportId?: string; flag: string; time: string; confidence: number }>;
    } | null;
  };
  forecast?: Record<string, MetricPoint[]>;
  measurements?: Pick<import('@littora/api-client/models').BeachScore['measurements'], 'forecast'>;
  providers?: Record<string, string>;
  reliability?: Record<string, string>;
  dataStatus?: Record<string, DataStatus>;
  disclaimer?: string;
  error?: string;
}

export interface DataStatus {
  status: 'available' | 'partial' | 'stale' | 'unknown';
  provider: string;
  kind?: string;
  fetchedAt: string | null;
  validAt: string | null;
  ageSeconds: number | null;
  nextCheckAt?: string | null;
  collectionIntervalSeconds?: number;
  producedAt?: string | null;
  units?: Record<string, string>;
}

export interface MetricPoint {
  time: string;
  value: number | null;
}

export interface BeachAmenity {
  referenceCount?: number;
  id: string;
  name: string;
  category: 'parking' | 'toilets' | 'rental' | 'food' | 'rescue' | 'other';
  lat: number;
  lon: number;
  distanceKm: number;
  source: string;
  verification?: 'listed' | 'to_verify';
}

export interface BeachAmenitiesResponse {
  beachId: string;
  provider: string;
  radiusMeters: number;
  amenities: BeachAmenity[];
  status?: 'available' | 'stale' | 'unknown';
  fetchedAt?: string | null;
  total?: number;
  coverage?: 'partial';
}

export type { ReportPayload } from '@littora/api-client/models';
