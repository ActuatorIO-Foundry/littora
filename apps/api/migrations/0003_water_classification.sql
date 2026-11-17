CREATE TABLE public.beach_water_classifications (
  beach_id uuid PRIMARY KEY REFERENCES public.beaches(id) ON DELETE CASCADE,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  water_type text NOT NULL CHECK (water_type IN ('sea','lake','river','unknown')),
  method text NOT NULL CHECK (method IN ('ign-proximity-v1','reviewed')),
  source_url text NOT NULL CHECK (source_url LIKE 'https://%'),
  classified_at timestamptz NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array'),
  CHECK (water_type = 'unknown' OR jsonb_array_length(evidence) > 0)
);

-- A moved beach loses its old classification until its new position is checked.
CREATE VIEW public.beach_catalogue AS
SELECT b.*, coalesce(c.water_type, 'unknown') AS water_type,
  CASE WHEN c.beach_id IS NULL THEN NULL ELSE jsonb_build_object(
    'method',c.method,'sourceUrl',c.source_url,'classifiedAt',c.classified_at,
    'reason',c.reason,'evidence',c.evidence
  ) END AS water_classification
FROM public.beaches b LEFT JOIN public.beach_water_classifications c
ON c.beach_id = b.id AND c.lat = b.lat AND c.lon = b.lon;
