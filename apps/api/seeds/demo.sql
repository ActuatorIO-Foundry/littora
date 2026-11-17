-- Executed only with explicit opt-in on a separate *_demo database.
INSERT INTO public.water_quality(beach_id,status,classification,sample_date,source,raw,is_demo)
SELECT id,'excellent','A',DATE '2026-01-01','demo-seed',
  '{"demo":true,"note":"Synthetic fixture, not a sanitary observation"}'::jsonb,true
FROM public.beaches WHERE seed_key LIKE 'reference:%'
ON CONFLICT (beach_id) WHERE source = 'demo-seed' AND is_demo DO NOTHING;
