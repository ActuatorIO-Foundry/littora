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

umask 077
fixture=$(mktemp -d)
target=
cleanup() {
  rm -r "$fixture"
  if [[ -n $target ]]; then
    docker rm -fv "$target" >/dev/null
  fi
}
trap cleanup EXIT
export BACKUP_DIR="$fixture/archives"
mkdir -m 700 "$BACKUP_DIR"
age-keygen -o "$fixture/restore.agekey" 2>/dev/null
export AGE_RECIPIENT
AGE_RECIPIENT=$(age-keygen -y "$fixture/restore.agekey")
export BACKUP_RETENTION_DAYS=14
backup_script="$(dirname "$0")/backup-postgres.sh"

docker exec "$POSTGRES_CONTAINER" psql -U "$user" -d "$db" -v ON_ERROR_STOP=1 -c \
  "insert into reports(id,beach_id,type,value,status) select '00000000-0000-4000-8000-000000000099',id,'flag','{\"flag\":\"red\"}','rejected' from beaches order by id limit 1 on conflict do nothing;
   insert into water_quality(beach_id,status,source,sample_date) select id,'excellent','restore-fixture',date '2025-01-01' from beaches order by id limit 1;"
docker exec "$POSTGRES_CONTAINER" psql -U "$user" -d "$db" -v ON_ERROR_STOP=1 -c \
  "create table restore_geometry_fixture(id int primary key, geom geometry(Geometry,4326));
   insert into restore_geometry_fixture values
   (1,ST_GeomFromText('LINESTRING(6 43,6.1 43.2,6.3 43.1)',4326)),
   (2,ST_GeomFromText('POLYGON((6 43,7 43,7 44,6 44,6 43),(6.2 43.2,6.2 43.4,6.4 43.4,6.4 43.2,6.2 43.2))',4326));
   create index restore_geometry_idx on restore_geometry_fixture using gist(geom);"
expired="$BACKUP_DIR/littora-pg-20000101T000000Z-TEMP0001.dump.age"
unrelated="$BACKUP_DIR/operator-copy.dump.age"
touch -t 200001010000 "$expired" "$unrelated"
if POSTGRES_CONTAINER="missing-$(basename "$fixture")" bash "$backup_script" >/dev/null 2>&1; then
  printf 'Failed dump incorrectly accepted.\n' >&2; exit 1
fi
[[ -f $expired && -f $unrelated && $(find "$BACKUP_DIR" -type f | wc -l) -eq 2 ]]
backup="$BACKUP_DIR/$(bash "$backup_script")"
[[ -s $backup && ! -e $expired && -f $unrelated ]]
[[ $(find "$backup" -perm 0600 -print) == "$backup" ]]
[[ -z $(find "$BACKUP_DIR" -name '.littora-pg.*' -print) ]]
age-keygen -o "$fixture/unrelated.agekey" 2>/dev/null
if age -d -i "$fixture/unrelated.agekey" "$backup" >/dev/null 2>&1; then
  printf 'Unrelated key incorrectly accepted.\n' >&2; exit 1
fi
dd if="$backup" of="$fixture/truncated.age" bs=1 count=256 2>/dev/null
if age -d -i "$fixture/restore.agekey" "$fixture/truncated.age" >/dev/null 2>&1; then
  printf 'Truncated archive incorrectly accepted.\n' >&2; exit 1
fi
image=$(docker inspect --format '{{.Image}}' "$POSTGRES_CONTAINER")
target=$(docker run -d --network none --platform linux/amd64 --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER="$user" -e POSTGRES_PASSWORD=test-only-password -e POSTGRES_DB=postgres "$image")
for _ in {1..90}; do
  if docker exec "$target" pg_isready -h 127.0.0.1 -U "$user" -d postgres >/dev/null; then break; fi
  sleep 1
done
docker exec "$target" createdb -U "$user" -T template0 "$restored"
age -d -i "$fixture/restore.agekey" "$backup" |
  docker exec -i "$target" pg_restore -U "$user" -d "$restored" --single-transaction --exit-on-error
query="select md5(coalesce(string_agg(row_to_json(t)::text, '' order by id), '')) from %s t;"
for table in beaches reports water_quality restore_geometry_fixture schema_migrations; do
  if [[ "$table" == schema_migrations ]]; then
    sql="select md5(coalesce(string_agg(row_to_json(t)::text, '' order by version), '')) from schema_migrations t;"
  else
    sql=$(printf "$query" "$table")
  fi
  expected=$(docker exec "$POSTGRES_CONTAINER" psql -U "$user" -d "$db" -Atc "$sql")
  actual=$(docker exec "$target" psql -U "$user" -d "$restored" -Atc "$sql")
  if [[ "$expected" != "$actual" ]]; then
    printf 'Restore mismatch: %s\n' "$table" >&2
    exit 1
  fi
done
docker exec "$target" psql -U "$user" -d "$restored" -v ON_ERROR_STOP=1 -c 'select PostGIS_Version();'
printf '%s\n' 'Encrypted restore verified: identifiers, reports, water quality, geometries and migrations preserved.'
