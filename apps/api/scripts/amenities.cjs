// Operator-only. Reading the catalogue or previewing a file never contacts Overpass.
const { Pool } = require('pg');
const { parseAmenities } = require('../dist/modules/beaches/amenities');
const { AmenitiesService } = require('../dist/modules/beaches/amenities.service');

const geoSource = /^https:\/\/download\.geofabrik\.de\/europe\/france\/([a-z-]+)\/\1-latest\.osm\.pbf$/;
function validate(doc, now = Date.now(), regional = false) {
  const age = now - Date.parse(doc?.asOf);
  const validSource = /^https:\/\/download\.openstreetmap\.fr\/extracts\/europe\/france\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+-latest\.osm\.pbf$/;
  if (doc?.version !== 1 || !(regional ? geoSource : validSource).test(doc.source) || !Number.isFinite(age) ||
      age < 0 || age >= (regional ? 168 : 48)*3600_000) throw Error('Invalid source or expired extract');
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
  return importSites(db,rows,doc,apply,false);
}

async function importSites(db,rows,doc,apply,allowEmpty) {
  const service = new AmenitiesService(db);
  const report={ sites:rows.length, edge:0, withoutPoints:0, withPoints:0, associations:0, updated:0, preserved:0, asOf:doc.asOf };
  for (const site of rows) {
    if (!covers(doc.bounds,site)) {report.edge++;continue;}
    // Leave a small margin for the spherical approximation; use the same ellipsoid as the public map.
    const candidates=parseAmenities(doc,site,2.52);
    const matches=candidates.length ? (await db.query(`select i::int from
      unnest($1::float8[], $2::float8[]) with ordinality as a(lat,lon,i)
      where ST_DWithin(ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography,
        ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,2500) order by i`,
      [candidates.map(p=>p.lat),candidates.map(p=>p.lon),site.lon,site.lat])).rows : [];
    const points=matches.map(({i})=>candidates[i-1]);
    if (!points.length) {
      report.withoutPoints++;
      if (!allowEmpty) continue;
    } else {report.withPoints++;report.associations+=points.length;}
    if(apply) {
      if(await service.persist(site,points,doc.source,doc.asOf)) report.updated++;
      else report.preserved++;
    }
  }
  return report;
}

async function importRegion(db, input, apply) {
  const {createInterface}=require('node:readline');
  const seen=new Set();
  const totals={sites:0,withPoints:0,withoutPoints:0,associations:0,updated:0,preserved:0};
  let source,date;
  for await(const line of createInterface({input,crlfDelay:Infinity})){
    if(Buffer.byteLength(line)>8*1024*1024 || seen.size>=5000) throw Error('Region input limit exceeded');
    const doc=validate(JSON.parse(line),Date.now(),true);
    const site=doc.site;
    if(!site || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(site.id) ||
       typeof site.completeWindow!=='boolean'||!Number.isFinite(site.lat)||!Number.isFinite(site.lon)|| !covers(doc.bounds,site) ||
       seen.has(site.id) || (source && (source!==doc.source || date!==doc.asOf))) throw Error('Invalid region/site identity');
    seen.add(site.id);source=doc.source;date=doc.asOf;
    const {rows}=await db.query('select id,lat,lon from beach_catalogue where id=$1 and lat=$2 and lon=$3',[site.id,site.lat,site.lon]);
    if(rows.length!==1) throw Error('Public site moved or no longer present');
    const stats=await importSites(db,rows,doc,apply,site.completeWindow);
    for(const key of Object.keys(totals)) totals[key]+=stats[key];
  }
  if(!seen.size) throw Error('Empty region file');
  return {...totals,source,asOf:date};
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
  if(!['preview','apply','coverage','sites','region-preview','region-apply'].includes(mode) ||
    (['preview','apply'].includes(mode)?!city:city!==undefined) || rest.length || !process.env.DATABASE_URL)
    throw Error('Use: amenities.cjs coverage|sites|region-preview|region-apply|preview CITY|apply CITY');
  const db=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
  try {
    if(mode==='coverage') return console.log(JSON.stringify(await coverage(db)));
    if(mode==='sites') return console.log(JSON.stringify((await db.query('select id,lat,lon from beach_catalogue order by id')).rows));
    if(mode.startsWith('region-')) {
      const {source,asOf,...counts}=await importRegion(db,process.stdin,mode==='region-apply');
      return console.log(JSON.stringify({...counts,asOf:new Date(asOf).toISOString()}));
    }
    const chunks=[];let bytes=0;
    for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>8*1024*1024) throw Error('Extract too large');chunks.push(chunk);}
    const report=await importCity(db,city,JSON.parse(Buffer.concat(chunks).toString()),mode==='apply');
    console.log(JSON.stringify({...report,asOf:new Date(report.asOf).toISOString()}));
  } finally {await db.end();}
}
module.exports={validate,covers,importCity,importRegion,coverage};
if(require.main===module)main().catch(()=>{console.error('{"event":"amenities_operation_failed"}');process.exitCode=1;});
