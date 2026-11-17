ALTER TABLE public.beaches ADD COLUMN seed_key text;
CREATE UNIQUE INDEX beaches_seed_key_unique_idx
ON public.beaches(seed_key) WHERE seed_key IS NOT NULL;

ALTER TABLE public.water_quality ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
-- Retain the historical samples and their IDs, but identify their simulated origin.
UPDATE public.water_quality SET is_demo = true WHERE source = 'local-seed';
CREATE UNIQUE INDEX water_quality_demo_seed_unique_idx
ON public.water_quality(beach_id) WHERE source = 'demo-seed' AND is_demo;
