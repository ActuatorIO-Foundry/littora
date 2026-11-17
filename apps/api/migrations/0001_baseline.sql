CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.beaches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text, department text, region text, coastline text,
  lat double precision NOT NULL, lon double precision NOT NULL,
  geom geography(Point,4326),
  has_lifeguard boolean DEFAULT false,
  has_parking boolean DEFAULT false,
  has_toilets boolean DEFAULT false,
  osm_id text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beach_id uuid REFERENCES public.beaches(id),
  type text NOT NULL,
  value jsonb DEFAULT '{}', confidence numeric DEFAULT .5,
  status text DEFAULT 'pending', created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.water_quality (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beach_id uuid REFERENCES public.beaches(id),
  status text, classification text, sample_date date, source text,
  raw jsonb DEFAULT '{}'
);

-- Adopt the historical schema without replacing UUIDs or populated geometries.
ALTER TABLE public.beaches ADD COLUMN IF NOT EXISTS geom geography(Point,4326);
ALTER TABLE public.beaches ADD COLUMN IF NOT EXISTS osm_id text;
UPDATE public.beaches
SET geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
WHERE geom IS NULL;
CREATE INDEX IF NOT EXISTS beaches_geom_idx ON public.beaches USING gist(geom);
CREATE UNIQUE INDEX IF NOT EXISTS beaches_osm_id_unique_idx
ON public.beaches(osm_id) WHERE osm_id IS NOT NULL;
