import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Local-only preparation. Never mounts or modifies a source data volume.
const keepPaused = process.argv.includes('--keep-paused');
const compose = ['compose', '-f', 'docker-compose.local.yml'];
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024, ...options,
});
const inspect = (id) => JSON.parse(docker(['inspect', id]))[0];
const source = Object.fromEntries(['api', 'postgres', 'redis'].map((service) => {
  const id = docker([...compose, 'ps', '-aq', service]).trim();
  assert.ok(id && !id.includes('\n'), `Expected one local ${service} container`);
  const info = inspect(id);
  assert.equal(info.Config.Labels['com.docker.compose.service'], service);
  assert.ok(info.State.Running, `${service} must be running`);
  return [service, { id, image: info.Image, mounts: info.Mounts }];
}));
const postgresImage = 'littora-postgres:16.16-3.7.0-r3';
const redisImage = 'littora-redis:7.4.12-r2';
const id = `littora-upgrade-${randomUUID().slice(0, 8)}`;
const directory = resolve('.local/backups', id);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const save = (name, data) => writeFileSync(resolve(directory, name), data, { mode: 0o600 });
const json = (name, data) => save(name, JSON.stringify(data, null, 2) + '\n');
const sql = (container, database, statement) => docker([
  'exec', container, 'psql', '-U', 'littora', '-d', database, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', statement,
]).trim();
assert.equal(sql(source.postgres.id, 'littora', 'show server_version_num').slice(0, 2), '16');
const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
const tableHash = (container, database, schema, table) => sql(container, database,
  `select count(*) || ':' || md5(coalesce(string_agg(row_to_json(t)::text, E'\\n' order by row_to_json(t)::text collate "C"),'')) from ${quote(schema)}.${quote(table)} t`);
function snapshot(container, database) {
  const names = JSON.parse(sql(container, database, `select coalesce(json_agg(json_build_array(schemaname,tablename) order by schemaname,tablename),'[]')
    from pg_tables where schemaname not in ('pg_catalog','information_schema') and tablename <> 'spatial_ref_sys'`));
  const tables = {};
  for (const [schema, table] of names) {
    tables[`${schema}.${table}`] = tableHash(container, database, schema, table);
  }
  return {
    tables,
    geometry: sql(container, database, "select count(*) || ':' || md5(string_agg(id::text || ':' || encode(ST_AsEWKB(geom::geometry),'hex'), ',' order by id)) from beaches where geom is not null"),
    indexes: sql(container, database, "select indexname || ':' || indexdef from pg_indexes where schemaname='public' and tablename <> 'spatial_ref_sys' order by indexname"),
    constraints: sql(container, database, "select c.conname || ':' || pg_get_constraintdef(c.oid) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.conrelid <> 'spatial_ref_sys'::regclass order by c.conname"),
    nearest: sql(container, database, "select id from beaches order by geom <-> ST_SetSRID(ST_MakePoint(6.3,43.1),4326)::geography,id limit 10"),
  };
}
function redisSnapshot(container) {
  const config = JSON.parse(docker(['exec', container, 'redis-cli', '--json', 'CONFIG', 'GET', 'databases']));
  const count = Number(config.databases);
  assert.ok(count >= 1 && count <= 1024);
  const entries = [];
  const script = `local result = {}; local cursor = '0'; repeat local scan = redis.call('SCAN',cursor); cursor=scan[1];
    for _,key in ipairs(scan[2]) do local value=redis.call('DUMP',key); if value then table.insert(result,{key,redis.sha1hex(value),redis.call('PEXPIRETIME',key)}) end end
    until cursor == '0'; return result`;
  for (let db = 0; db < count; db++) {
    const rows = JSON.parse(docker(['exec', container, 'redis-cli', '-n', String(db), '--json', 'EVAL', script, '0']));
    for (const [key, hash, expires] of rows) entries.push({ db, key, hash, expires });
  }
  return entries.sort((a, b) => a.db - b.db || a.key.localeCompare(b.key));
}
const containers = [];
async function startPostgres(name, image, volume) {
  docker(['volume', 'create', volume]);
  docker(['run', '-d', '--name', name, '--platform', 'linux/amd64', '--network', 'none',
    '-e', 'POSTGRES_USER=littora', '-e', 'POSTGRES_PASSWORD=restore-only-password', '-e', 'POSTGRES_DB=restore_bootstrap',
    '-v', `${volume}:/var/lib/postgresql/data`, image]);
  containers.push(name);
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      docker(['exec', '-e', 'PGPASSWORD=restore-only-password', name, 'psql', '-h', '127.0.0.1', '-U', 'littora', '-d', 'restore_bootstrap', '-Atc', 'select 1']);
      return;
    } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error('Restored PostgreSQL startup timeout');
}
function restorePostgres(name, dump) {
  docker(['exec', name, 'createdb', '-U', 'littora', '-T', 'template0', 'littora']);
  docker(['exec', '-i', name, 'pg_restore', '-U', 'littora', '-d', 'littora', '--exit-on-error'], { input: dump });
}
let paused = false;
let prepared = false;
try {
  console.log('Pausing API writers for a consistent PostgreSQL and Redis backup.');
  paused = true;
  docker(['stop', '--time', '30', source.api.id]);
  const before = snapshot(source.postgres.id, 'littora');
  const redisBefore = redisSnapshot(source.redis.id);
  const dump = docker(['exec', source.postgres.id, 'pg_dump', '-U', 'littora', '-d', 'littora', '-Fc'], { encoding: null });
  save('littora.dump', dump);
  // Roles/passwords stay in the private backup and are not printed or committed.
  const roles = docker(['exec', source.postgres.id, 'pg_dumpall', '-U', 'littora', '--roles-only']);
  save('roles.sql', roles);
  docker(['exec', source.redis.id, 'redis-cli', 'SAVE']);
  const redisConfig = JSON.parse(docker(['exec', source.redis.id, 'redis-cli', '--json', 'CONFIG', 'GET', 'dir', 'dbfilename']));
  docker(['cp', `${source.redis.id}:${redisConfig.dir}/${redisConfig.dbfilename}`, resolve(directory, 'dump.rdb')]);
  chmodSync(resolve(directory, 'dump.rdb'), 0o600);
  // Include AOF files for forensics/rollback, but restore the consistent RDB only.
  save('redis-data.tar', docker(['exec', source.redis.id, 'tar', '-C', redisConfig.dir, '-cf', '-', '.'], { encoding: null }));
  const manifest = { createdAt: new Date().toISOString(), source, before, redisBefore,
    sha256: createHash('sha256').update(dump).digest('hex'), postgresImage, redisImage };
  json('manifest.json', manifest);
  if (!keepPaused) { docker(['start', source.api.id]); paused = false; }

  // Also supplies the pristine old extension defaults for the comparison below.
  const rollback = `${id}-rollback`;
  await startPostgres(rollback, source.postgres.image, `${id}-rollback`);
  restorePostgres(rollback, dump);
  assert.deepEqual(snapshot(rollback, 'littora'), before, 'Rollback restore differs from source');

  const pgVolume = `${id}-pgdata`;
  const redisVolume = `${id}-redisdata`;
  const pg = `${id}-postgres`;
  await startPostgres(pg, postgresImage, pgVolume);
  restorePostgres(pg, dump);
  const after = snapshot(pg, 'littora');
  const expected = structuredClone(before);
  const extensionDefaultsUpdated = [];
  for (const [name, hash] of Object.entries(after.tables)) {
    if (hash === before.tables[name]) continue;
    const [schema, table] = name.split('.');
    // Never exempt custom Tiger data: only a table identical to the pristine
    // old extension defaults may adopt the new release's reference data.
    assert.equal(schema, 'tiger', `Unexpected table change: ${name}`);
    assert.equal(sql(rollback, 'restore_bootstrap', `select count(*) from pg_depend where classid='pg_class'::regclass and objid='${schema}.${table}'::regclass and deptype='e'`), '1');
    assert.equal(before.tables[name], tableHash(rollback, 'restore_bootstrap', schema, table), `Modified extension data: ${name}`);
    expected.tables[name] = hash;
    extensionDefaultsUpdated.push(name);
  }
  assert.deepEqual(after, expected, 'PostgreSQL restore differs from source');
  assert.equal(sql(pg, 'littora', 'select PostGIS_Lib_Version()'), '3.7.0');
  // Restore the existing login, not the disposable bootstrap password.
  const password = roles.match(/ALTER ROLE littora WITH[^;]+;/)?.[0];
  assert.ok(password, 'Missing source database role');
  sql(pg, 'littora', password);
  sql(pg, 'littora', 'analyze beaches');
  assert.match(sql(pg, 'littora', 'set enable_seqscan=off; explain select id from beaches order by geom <-> ST_SetSRID(ST_MakePoint(6.3,43.1),4326)::geography limit 10'), /Index Scan.*beaches_geom_idx/);
  docker(['volume', 'create', redisVolume]);
  const redis = `${id}-redis`;
  docker(['create', '--name', redis, '--network', 'none', '-v', `${redisVolume}:/data`, redisImage]);
  containers.push(redis);
  docker(['cp', resolve(directory, 'dump.rdb'), `${redis}:/data/dump.rdb`]);
  docker(['start', redis]);
  for (let attempt = 0; attempt < 60; attempt++) {
    try { assert.equal(docker(['exec', redis, 'redis-cli', 'PING']).trim(), 'PONG'); break; }
    catch { if (attempt === 59) throw new Error('Redis startup timeout'); await new Promise((r) => setTimeout(r, 500)); }
  }
  const redisAfter = redisSnapshot(redis);
  const now = Date.now();
  assert.deepEqual(redisAfter.filter((r) => r.expires === -1 || r.expires > now), redisBefore.filter((r) => r.expires === -1 || r.expires > now), 'Redis values or absolute expiration dates changed');

  json('verified.json', { postgresVolume: pgVolume, redisVolume, rollbackVolume: `${id}-rollback`,
    tables: Object.keys(before.tables).length, redisKeys: redisAfter.length,
    extensionDefaultsUpdated, verifiedAt: new Date().toISOString(), keepPaused });
  prepared = true;
  console.log(`Verified restore and rollback: ${directory}`);
  console.log(`POSTGRES_VOLUME=${pgVolume}\nREDIS_VOLUME=${redisVolume}\nSTORAGE_VOLUMES_EXTERNAL=true`);
} finally {
  try {
    for (const container of containers.reverse()) docker(['rm', '-f', container]);
  } finally {
    // A cleanup error must not leave the original API stopped.
    if (paused && (!keepPaused || !prepared)) docker(['start', source.api.id]);
  }
}
