-- Immutable official releases. A new release never rewrites measurements or beach identities.
CREATE TABLE ars_releases (
  id text PRIMARY KEY, season integer NOT NULL, sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  sources jsonb NOT NULL, stats jsonb NOT NULL, rejected jsonb NOT NULL, imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ars_sites (
  release text NOT NULL REFERENCES ars_releases, code text NOT NULL, insee text NOT NULL,
  name text NOT NULL, city text NOT NULL, lat double precision NOT NULL, lon double precision NOT NULL,
  status text NOT NULL CHECK(status IN ('matched','review','unmatched')),
  beach_id uuid REFERENCES beaches, evidence jsonb, candidates jsonb NOT NULL,
  PRIMARY KEY (release,code), UNIQUE (release,beach_id),
  CHECK ((status='matched')=(beach_id IS NOT NULL))
);
CREATE TABLE ars_observations (
  release text NOT NULL, code text NOT NULL, product text NOT NULL CHECK(product IN ('sample','class','closure','pollution','event')),
  identity text NOT NULL, observed date, ended date, data jsonb NOT NULL,
  PRIMARY KEY (release,code,product,identity),
  FOREIGN KEY(release,code) REFERENCES ars_sites(release,code),
  CHECK (ended IS NULL OR ended>=observed)
);
CREATE INDEX ars_observations_latest ON ars_observations(release,code,product,observed DESC);
CREATE VIEW ars_linked_sites AS
  SELECT s.*,r.season,r.sources FROM ars_sites s JOIN ars_releases r ON r.id=s.release
  JOIN beach_catalogue b ON b.id=s.beach_id AND
    s.evidence=jsonb_build_object('id',b.id,'name',b.name,'city',b.city,'lat',b.lat,'lon',b.lon,'water_type',b.water_type)
  WHERE NOT EXISTS (SELECT 1 FROM ars_releases newer WHERE newer.season=r.season AND newer.sequence>r.sequence);

-- Explicit authority decisions, independent of annual archives and laboratory results.
CREATE TABLE bathing_restrictions (
  beach_id uuid NOT NULL REFERENCES beaches, reference text NOT NULL, authority text NOT NULL,
  closed_on date NOT NULL, closure_url text NOT NULL, lifted_on date, lift_url text,
  PRIMARY KEY(beach_id,reference), CHECK(lifted_on IS NULL OR lifted_on>=closed_on),
  CHECK((lifted_on IS NULL)=(lift_url IS NULL))
);
CREATE VIEW active_bathing_restrictions AS
  SELECT * FROM bathing_restrictions WHERE closed_on<=(now() AT TIME ZONE 'Europe/Paris')::date
    AND (lifted_on IS NULL OR lifted_on>(now() AT TIME ZONE 'Europe/Paris')::date);
