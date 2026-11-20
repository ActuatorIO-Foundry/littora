// Operator-only. Reading the catalogue or previewing a file never contacts Overpass.
const { Pool } = require('pg');
const { parseAmenities } = require('../dist/modules/beaches/amenities');
const { AmenitiesService } = require('../dist/modules/beaches/amenities.service');

function validate(doc, now = Date.now()) {
  const age = now - Date.parse(doc?.asOf);
  const validSource = /^https:\/\/download\.openstreetmap\.fr\/extracts\/europe\/france\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+-latest\.osm\.pbf$/;
  if (doc?.version !== 1 || !validSource.test(doc.source) || !Number.isFinite(age) || age < 0 || age >= 48*3600_000)
    throw Error('Invalid source or extract older than 48 hours');
  if (!Array.isArray(doc.bounds) || doc.bounds.length !== 4 || !doc.bounds.every(Number.isFinite)) throw Error('Invalid bounds');
  const [s,w,n,e] = doc.bounds;
  if (!(s >= 41 && n <= 52 && w >= -6 && e <= 10 && n > s && n-s <= 0.5 && e > w && e-w <= 0.5)) throw Error('Invalid bounds');
  if (!Array.isArray(doc.elements) || doc.elements.length > 5000 || doc.remark) throw Error('Invalid elements');
  const seen = new Set();
  for (const row of doc.elements) {
    if (!['node','way','relation'].includes(row?.type) || !Number.isSafeInteger(row.id) || row.id <= 0 ||
        !Number.isFinite(row.lat) || !Number.isFinite(row.lon) || row.lat < s || row.lat > n || row.lon < w || row.lon > e ||
        !row.tags || typeof row.tags !== 'object' || Array.isArray(row.tags) || !Object.values(row.tags).every(x=>typeof x==='string') ||
        !Number.isFinite(Date.parse(row.timestamp)) || Date.parse(row.timestamp)>Date.parse(doc.asOf)) throw Error('Invalid element in extract');
    const key = row.type+'/'+row.id;
    if (seen.has(key)) throw Error('Duplicate OSM identity');
    seen.add(key);
  }
  return doc;
}

function covers([s,w,n,e], {lat,lon}) {
  // Conservative envelope for the complete 2.5 km disk at metropolitan latitudes.
  const dy=2.5/110, dx=dy/Math.cos((Math.abs(lat)+dy)*Math.PI/180);
  return lat-dy>=s && lat+dy<=n && lon-dx>=w && lon+dx<=e;
}

async function importCity(db, city, doc, apply) {
  validate(doc);
  if (!city?.trim() || city.length>120) throw Error('Expected a single municipality');
  const { rows } = await db.query(`select id,lat,lon from beach_catalogue where lower(city)=lower($1)
    and lat between $2 and $4 and lon between $3 and $5 order by id limit 101`,[city,...doc.bounds]);
  if (!rows.length || rows.length>100) throw Error('Expected 1 to 100 public sites in the named municipality and window');
  const service = new AmenitiesService(db);
  const report={ sites:rows.length, edge:0, withoutPoints:0, withPoints:0, associations:0, updated:0, preserved:0, asOf:doc.asOf };
  for (const site of rows) {
    if (!covers(doc.bounds,site)) {report.edge++;continue;}
    const points=parseAmenities(doc,site);
    if (!points.length) {report.withoutPoints++;continue;} // A partial offline extract cannot prove an empty inventory.
    report.withPoints++;report.associations+=points.length;
    if(apply) {
      if(await service.persist(site,points,doc.source,doc.asOf)) report.updated++;
      else report.preserved++;
    }
  }
  return report;
}

async function coverage(db) {
  const { rows }=await db.query(`with inventory as (
    select b.id, c.fetched_at > now()-interval '7 days' and c.fetched_at <= now() as usable,
      count(a.osm_id)::int as points
    from beach_catalogue b left join beach_amenity_collections c on c.beach_id=b.id and c.lat=b.lat and c.lon=b.lon
    left join beach_amenities a on a.beach_id=c.beach_id and ST_DWithin(
      ST_SetSRID(ST_MakePoint(a.lon,a.lat),4326)::geography,ST_SetSRID(ST_MakePoint(b.lon,b.lat),4326)::geography,2500)
    group by b.id,c.fetched_at)
    select count(*)::int as sites, count(*) filter(where usable and points>0)::int as populated,
      count(*) filter(where usable and points=0)::int as empty, count(*) filter(where usable is not true)::int as unknown,
      coalesce(sum(points) filter(where usable),0)::int as associations from inventory`);
  return rows[0];
}

async function main() {
  const [mode,city,...rest]=process.argv.slice(2);
  if(!['preview','apply','coverage'].includes(mode) || (mode==='coverage'?city!==undefined:!city) || rest.length || !process.env.DATABASE_URL)
    throw Error('Use: amenities.cjs coverage | preview CITY | apply CITY (JSON on stdin)');
  const db=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
  try {
    if(mode==='coverage') return console.log(JSON.stringify(await coverage(db)));
    const chunks=[];let bytes=0;
    for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>8*1024*1024) throw Error('Extract too large');chunks.push(chunk);}
    console.log(JSON.stringify(await importCity(db,city,JSON.parse(Buffer.concat(chunks).toString()),mode==='apply')));
  } finally {await db.end();}
}
module.exports={validate,covers,importCity,coverage};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
