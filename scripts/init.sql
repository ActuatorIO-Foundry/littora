create extension if not exists postgis;
create extension if not exists pgcrypto;
create table if not exists beaches(id uuid primary key default gen_random_uuid(),name text not null,city text,department text,region text,coastline text,lat double precision not null,lon double precision not null,geom geography(Point,4326),has_lifeguard boolean default false,has_parking boolean default false,has_toilets boolean default false,osm_id text,created_at timestamptz default now());
create table if not exists reports(id uuid primary key default gen_random_uuid(),beach_id uuid references beaches(id),type text not null,value jsonb default '{}',confidence numeric default .5,status text default 'pending',created_at timestamptz default now());
create table if not exists water_quality(id uuid primary key default gen_random_uuid(),beach_id uuid references beaches(id),status text,classification text,sample_date date,source text,raw jsonb default '{}');
alter table beaches add column if not exists geom geography(Point,4326);
update beaches set geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography where geom is null;
create index if not exists beaches_geom_idx on beaches using gist(geom);
create unique index if not exists beaches_osm_id_unique_idx on beaches(osm_id) where osm_id is not null;
insert into beaches(name,city,department,region,coastline,lat,lon,has_lifeguard,has_parking,has_toilets) values
('Plage de Pampelonne','Ramatuelle','Var','Provence-Alpes-Côte d’Azur','Méditerranée',43.2409,6.6635,true,true,true),
('Plage de la Nartelle','Sainte-Maxime','Var','Provence-Alpes-Côte d’Azur','Méditerranée',43.3308,6.6882,true,true,true),
('Plage de la Salis','Antibes','Alpes-Maritimes','Provence-Alpes-Côte d’Azur','Méditerranée',43.5736,7.1287,true,true,true),
('Plage du Sillon','Saint-Malo','Ille-et-Vilaine','Bretagne','Manche',48.6561,-2.0123,true,true,true),
('Plage de la Côte des Basques','Biarritz','Pyrénées-Atlantiques','Nouvelle-Aquitaine','Atlantique',43.4775,-1.5686,true,true,true)
on conflict do nothing;
update beaches set geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography where geom is null;
insert into water_quality(beach_id,status,classification,sample_date,source,raw)
select id,
  case when coastline='Méditerranée' then 'excellent' else 'good' end,
  case when coastline='Méditerranée' then 'A' else 'B' end,
  current_date - interval '12 days',
  'local-seed',
  jsonb_build_object('note','Seed local remplacable par ingestion officielle')
from beaches
where not exists(select 1 from water_quality where water_quality.beach_id=beaches.id);
