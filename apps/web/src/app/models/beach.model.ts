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
    communityFlag?: {
      flag: 'green' | 'yellow' | 'red';
      confidence: number;
      counts: Record<string, number>;
      history: Array<{ flag: string; time: string; confidence: number }>;
    } | null;
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
  verification?: 'listed' | 'to_verify';
}

export interface BeachAmenitiesResponse {
  beachId: string;
  provider: string;
  radiusMeters: number;
  amenities: BeachAmenity[];
}

export interface ReportPayload {
  beachId: string;
  type: 'jellyfish' | 'pollution' | 'current' | 'crowd' | 'flag' | 'other';
  value?: Record<string, unknown>;
  confidence?: number;
}
