-- Forecast state is separate from catalogue records. A zone is ~1 km, not a beach observation.
CREATE VIEW forecast_targets AS
SELECT DISTINCT s.source, floor(b.lat * 100 + 0.5)::int AS y, floor(b.lon * 100 + 0.5)::int AS x
FROM beach_catalogue b CROSS JOIN (VALUES ('open-meteo'), ('open-meteo-marine')) s(source)
WHERE s.source = 'open-meteo' OR b.water_type = 'sea';

CREATE TABLE forecast_zones (
  source text NOT NULL, y int NOT NULL, x int NOT NULL,
  last_attempt_at timestamptz NOT NULL, next_check_at timestamptz NOT NULL,
  last_success_at timestamptz, payload jsonb, failures int NOT NULL DEFAULT 0, error_code text,
  PRIMARY KEY (source,y,x)
);
-- Reserve quota before HTTP, including timeouts and process crashes.
CREATE TABLE forecast_dispatch (
  singleton boolean PRIMARY KEY CHECK (singleton), next_request_at timestamptz NOT NULL
);
INSERT INTO forecast_dispatch VALUES (true, '-infinity');

CREATE TABLE forecast_projections (
  beach_id uuid PRIMARY KEY REFERENCES beaches(id) ON DELETE CASCADE, updated_at timestamptz NOT NULL
);
