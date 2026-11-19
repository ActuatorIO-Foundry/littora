-- Read-only witness for the local V1 acceptance run (one consistent snapshot).
WITH zones AS (
  SELECT t.source,t.y,t.x,z.last_attempt_at,z.last_success_at,z.next_check_at,z.error_code
  FROM forecast_targets t LEFT JOIN forecast_zones z USING(source,y,x)
), counts AS (
  SELECT source,count(*) AS targets,
    count(*) FILTER (WHERE last_attempt_at >= :'since'::timestamptz) AS attempted,
    count(*) FILTER (WHERE last_attempt_at >= :'since'::timestamptz AND last_success_at >= :'since'::timestamptz) AS succeeded,
    -- A claim writes its exact two-minute lease and leaves the previous error in place.
    -- Only the terminal failure update replaces that lease with the retry deadline.
    count(*) FILTER (WHERE last_attempt_at >= :'since'::timestamptz AND
      (last_success_at >= :'since'::timestamptz OR
       (error_code IS NOT NULL AND next_check_at <> last_attempt_at + interval '2 minutes'))) AS finished,
    count(*) FILTER (WHERE error_code IS NOT NULL) AS errors,
    count(*) FILTER (WHERE next_check_at IS NULL OR next_check_at <= now()) AS due
  FROM zones GROUP BY source
)
SELECT json_build_object(
  'at',current_timestamp,'scope',md5(
    (SELECT string_agg(format('%s:%s:%s',source,y,x),',' ORDER BY source,y,x) FROM zones)
    ||'|'||(SELECT string_agg(format('%s:%s:%s:%s',id,lat,lon,water_type),',' ORDER BY id) FROM beach_catalogue)),
  'catalogueIds',(SELECT encode(sha256(convert_to(string_agg(id::text,',' ORDER BY id),'UTF8')),'hex') FROM beach_catalogue),
  'sources',(SELECT json_agg(counts ORDER BY source) FROM counts));
