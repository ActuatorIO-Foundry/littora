CREATE TABLE public.beach_amenity_collections (
  beach_id uuid PRIMARY KEY REFERENCES public.beaches(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  fetched_at timestamptz,
  attempted_at timestamptz NOT NULL,
  source_url text NOT NULL,
  error_code text CHECK (error_code IN ('unavailable','invalid-response','configuration'))
);
CREATE TABLE public.beach_amenities (
  beach_id uuid NOT NULL REFERENCES public.beaches(id) ON DELETE CASCADE,
  osm_id text NOT NULL CHECK (osm_id ~ '^(node|way|relation)/[0-9]+$'),
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('parking','toilets','rescue','rental','food')),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  source_updated_at timestamptz,
  PRIMARY KEY (beach_id,osm_id)
);

-- OSM inventories describe nearby infrastructure, never current lifeguard duty.
CREATE VIEW public.beach_amenity_facts AS
WITH counts AS (
  SELECT b.id, max(c.fetched_at) AS fetched_at,
    count(a.osm_id) FILTER (WHERE category='parking') AS parking,
    count(a.osm_id) FILTER (WHERE category='toilets') AS toilets,
    count(a.osm_id) FILTER (WHERE category='rescue') AS rescue
  FROM public.beaches b
  LEFT JOIN public.beach_amenity_collections c ON c.beach_id=b.id AND c.lat=b.lat AND c.lon=b.lon
    AND c.fetched_at > now() - interval '7 days'
  LEFT JOIN public.beach_amenities a ON a.beach_id=c.beach_id
    AND ST_DWithin(ST_SetSRID(ST_MakePoint(a.lon,a.lat),4326)::geography,
      ST_SetSRID(ST_MakePoint(b.lon,b.lat),4326)::geography,2500)
  GROUP BY b.id
)
SELECT id AS beach_id, jsonb_object_agg(kind,jsonb_build_object(
  'value',CASE WHEN n>0 THEN true ELSE null END,
  'status',CASE WHEN n>0 THEN 'present' ELSE 'unknown' END,
  'source',CASE WHEN kind='lifeguard' OR fetched_at IS NULL THEN 'unknown' ELSE 'openstreetmap' END,
  'verified',false,'fetchedAt',CASE WHEN kind='lifeguard' THEN null ELSE fetched_at END,
  'scope',CASE WHEN kind='lifeguard' THEN 'unknown' ELSE 'nearby' END
)) AS facilities
FROM counts CROSS JOIN LATERAL (VALUES ('parking',parking),('toilets',toilets),('rescueStation',rescue),('lifeguard',0)) f(kind,n)
GROUP BY id;

CREATE OR REPLACE VIEW public.beach_catalogue AS
SELECT b.*, coalesce(c.water_type, 'unknown') AS water_type,
  CASE WHEN c.beach_id IS NULL THEN NULL ELSE jsonb_build_object(
    'method',c.method,'sourceUrl',c.source_url,'classifiedAt',c.classified_at,
    'reason',c.reason,'evidence',c.evidence
  ) END AS water_classification,
  f.facilities AS facility_facts
FROM public.beaches b LEFT JOIN public.beach_water_classifications c
ON c.beach_id=b.id AND c.lat=b.lat AND c.lon=b.lon
LEFT JOIN public.beach_amenity_facts f ON f.beach_id=b.id;
