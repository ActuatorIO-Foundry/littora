CREATE INDEX beach_amenities_site_category_idx ON public.beach_amenities (beach_id, category) INCLUDE (lat, lon);

-- Presence needs one nearby match per category, not national counts of all POIs.
CREATE FUNCTION public.beach_facilities_for(site_id uuid, site_lat double precision, site_lon double precision)
RETURNS jsonb LANGUAGE sql STABLE PARALLEL SAFE AS $facts$
SELECT f.facilities
FROM (VALUES (1)) anchor(n)
LEFT JOIN public.beach_amenity_collections c
  ON c.beach_id=site_id AND c.lat=site_lat AND c.lon=site_lon AND c.fetched_at > now() - interval '7 days'
CROSS JOIN LATERAL (
  SELECT jsonb_object_agg(k.kind,jsonb_build_object(
    'value',hit.present,
    'status',CASE WHEN hit.present THEN 'present' ELSE 'unknown' END,
    'source',CASE WHEN k.category IS NULL OR c.fetched_at IS NULL THEN 'unknown' ELSE 'openstreetmap' END,
    'verified',false,'fetchedAt',CASE WHEN k.category IS NULL THEN NULL ELSE c.fetched_at END,
    'scope',CASE WHEN k.category IS NULL THEN 'unknown' ELSE 'nearby' END
  )) AS facilities
  FROM (VALUES ('parking','parking'),('toilets','toilets'),('rescueStation','rescue'),('lifeguard',NULL)) k(kind,category)
  LEFT JOIN LATERAL (
    SELECT true AS present FROM public.beach_amenities a
    WHERE a.beach_id=c.beach_id AND a.category=k.category
      AND ST_DWithin(ST_SetSRID(ST_MakePoint(a.lon,a.lat),4326)::geography,
        ST_SetSRID(ST_MakePoint(site_lon,site_lat),4326)::geography,2500)
    LIMIT 1
  ) hit ON true
) f
$facts$;

CREATE OR REPLACE VIEW public.beach_amenity_facts AS
SELECT b.id AS beach_id, public.beach_facilities_for(b.id,b.lat,b.lon) AS facilities
FROM public.beaches b;
