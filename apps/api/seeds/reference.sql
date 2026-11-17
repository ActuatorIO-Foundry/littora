CREATE TEMP TABLE reference_seed (
  key text PRIMARY KEY, name text, city text, department text, region text,
  coastline text, lat double precision, lon double precision
) ON COMMIT DROP;

-- Location references only: no inferred facilities or sanitary measurements.
INSERT INTO reference_seed VALUES
('pampelonne','Plage de Pampelonne','Ramatuelle','Var','Provence-Alpes-Côte d’Azur','Méditerranée',43.2409,6.6635),
('nartelle','Plage de la Nartelle','Sainte-Maxime','Var','Provence-Alpes-Côte d’Azur','Méditerranée',43.3308,6.6882),
('salis','Plage de la Salis','Antibes','Alpes-Maritimes','Provence-Alpes-Côte d’Azur','Méditerranée',43.5736,7.1287),
('sillon','Plage du Sillon','Saint-Malo','Ille-et-Vilaine','Bretagne','Manche',48.6561,-2.0123),
('cote-des-basques','Plage de la Côte des Basques','Biarritz','Pyrénées-Atlantiques','Nouvelle-Aquitaine','Atlantique',43.4775,-1.5686);

-- Link one historical reference without deleting pre-existing duplicates or reports.
UPDATE public.beaches b SET seed_key = 'reference:' || s.key
FROM reference_seed s
WHERE b.id = (
  SELECT existing.id FROM public.beaches existing
  WHERE existing.seed_key IS NULL AND existing.name = s.name AND existing.city = s.city
    AND abs(existing.lat - s.lat) < 0.000001 AND abs(existing.lon - s.lon) < 0.000001
  ORDER BY existing.created_at NULLS LAST, existing.id LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM public.beaches WHERE seed_key = 'reference:' || s.key);

INSERT INTO public.beaches(name,city,department,region,coastline,lat,lon,geom,
  has_lifeguard,has_parking,has_toilets,seed_key)
SELECT name,city,department,region,coastline,lat,lon,
  ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography,
  NULL,NULL,NULL,'reference:' || key
FROM reference_seed
ON CONFLICT (seed_key) WHERE seed_key IS NOT NULL DO NOTHING;
