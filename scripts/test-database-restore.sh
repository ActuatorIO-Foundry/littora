#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_CONTAINER:?Set the disposable test PostgreSQL container ID}"
db=littora_ci_test
restored=littora_restore_test
user=littora
actual=$(docker exec "$POSTGRES_CONTAINER" printenv POSTGRES_DB)
if [[ "$actual" != "$db" ]]; then
  printf '%s\n' 'Refusing a container not dedicated to littora_ci_test.' >&2
  exit 1
fi

backup=$(mktemp)
created=0
cleanup() {
  rm -f "$backup"
  if [[ "$created" == 1 ]]; then
    docker exec "$POSTGRES_CONTAINER" dropdb -U "$user" "$restored"
  fi
}
trap cleanup EXIT

docker exec "$POSTGRES_CONTAINER" psql -U "$user" -d "$db" -v ON_ERROR_STOP=1 -c \
  "insert into reports(id,beach_id,type,value,status) select '00000000-0000-4000-8000-000000000099',id,'flag','{\"flag\":\"red\"}','rejected' from beaches order by id limit 1 on conflict do nothing;"
docker exec "$POSTGRES_CONTAINER" psql -U "$user" -d "$db" -v ON_ERROR_STOP=1 -c \
  "create table restore_geometry_fixture(id int primary key, geom geometry(Geometry,4326));
   insert into restore_geometry_fixture values
   (1,ST_GeomFromText('LINESTRING(6 43,6.1 43.2,6.3 43.1)',4326)),
   (2,ST_GeomFromText('POLYGON((6 43,7 43,7 44,6 44,6 43),(6.2 43.2,6.2 43.4,6.4 43.4,6.4 43.2,6.2 43.2))',4326));
   create index restore_geometry_idx on restore_geometry_fixture using gist(geom);"
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$user" -Fc "$db" > "$backup"
docker exec "$POSTGRES_CONTAINER" createdb -U "$user" -T template0 "$restored"
created=1
docker exec -i "$POSTGRES_CONTAINER" pg_restore -U "$user" -d "$restored" --exit-on-error < "$backup"
query="select md5(coalesce(string_agg(row_to_json(t)::text, '' order by id), '')) from %s t;"
for table in beaches reports water_quality restore_geometry_fixture; do
  sql=$(printf "$query" "$table")
  expected=$(docker exec "$POSTGRES_CONTAINER" psql -U "$user" -d "$db" -Atc "$sql")
  actual=$(docker exec "$POSTGRES_CONTAINER" psql -U "$user" -d "$restored" -Atc "$sql")
  if [[ "$expected" != "$actual" ]]; then
    printf 'Restore mismatch: %s\n' "$table" >&2
    exit 1
  fi
done
docker exec "$POSTGRES_CONTAINER" psql -U "$user" -d "$restored" -v ON_ERROR_STOP=1 -c 'select PostGIS_Version();'
printf '%s\n' 'Restore verified: identifiers, rows, reports and water quality preserved.'
