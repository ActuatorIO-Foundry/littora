export interface Beach {
  id: string;
  name: string;
  city: string;
  department: string;
  region: string;
  coastline: string;
  lat: number;
  lon: number;
  has_lifeguard: boolean;
  has_parking: boolean;
  has_toilets: boolean;
  osm_id: string | null;
  distanceKm: number | null;
}

export interface BeachScore {
  beach: Beach;
  current?: {
    weather?: Record<string, unknown>;
    marine?: Record<string, unknown>;
    tides?: Record<string, unknown>;
    waterQuality?: Record<string, unknown>;
  };
  scores: {
    bathing: number;
    family: number;
    paddle: number;
    boat: number;
  };
  summary?: {
    bathing?: string;
    family?: string;
    paddle?: string;
    boat?: string;
  };
  safety?: {
    flag: 'green' | 'yellow' | 'red';
    alerts: string[];
    source?: string;
    official?: boolean;
  };
  forecast?: Record<string, MetricPoint[]>;
  providers?: Record<string, string>;
  reliability?: Record<string, string>;
  disclaimer?: string;
  error?: string;
}

export interface MetricPoint {
  time: string;
  value: number;
}

export interface BeachAmenity {
  id: string;
  name: string;
  category: 'parking' | 'toilets' | 'rental' | 'food' | 'rescue' | 'other';
  lat: number;
  lon: number;
  distanceKm: number;
  source: string;
}

export interface BeachAmenitiesResponse {
  beachId: string;
  provider: string;
  radiusMeters: number;
  amenities: BeachAmenity[];
}

export interface ReportPayload {
  beachId: string;
  type: 'jellyfish' | 'pollution' | 'current' | 'crowd' | 'other';
  value?: Record<string, unknown>;
  confidence?: number;
}
