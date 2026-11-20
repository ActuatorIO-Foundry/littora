// Operator-only import. The local journal records source coverage independently of catalogue writes.
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { boundedJson } = require('../dist/shared/bounded-json');
const { assertCurrent } = require('./database.cjs');
const { applyZone } = require('./catalogue-zone-apply.cjs');

const codePattern=/^(?:(?:0[1-9]|[1-8]\d|9[0-5])\d{3}|2[AB]\d{3})$/;
const validSnapshot=s=>typeof s==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString()===s;
function meta(db) {
  const run=JSON.parse(db.prepare('select body from run').get().body);
  if(run.version!==1 || !validSnapshot(run.snapshot) || !codePattern.test(run.commune?.code)) throw Error('Unsupported zone journal');
  return run;
}
const group=rows=>Object.fromEntries(rows.map(r=>[r.key,r.n]));

function start(db,commune,snapshot) {
  const geom=commune.contour;
  if (!codePattern.test(commune.code) || !commune.nom || !commune.departement?.nom || !commune.region?.nom ||
    !['Polygon','MultiPolygon'].includes(geom?.type) || !validSnapshot(snapshot)) throw Error('Invalid commune or snapshot');
  const points=geom.type==='Polygon'?geom.coordinates.flat():geom.coordinates.flat(2);
  if (!points.length || points.some(([x,y])=>!Number.isFinite(x)||!Number.isFinite(y)||x < -6||x>10||y<41||y>52))
    throw Error('Invalid metropolitan geometry');
  const extent=points.reduce(([s,w,n,e],[x,y])=>[Math.min(s,y),Math.min(w,x),Math.max(n,y),Math.max(e,x)],[90,180,-90,-180]);
  const [s,w,n,e]=extent, rows=Math.ceil((n-s)/0.1), cols=Math.ceil((e-w)/0.1);
  if (!rows || !cols || rows*cols>1024) throw Error('Invalid zone extent');
  db.exec('begin immediate');
  try {
    db.exec(`create table run(body text not null);
      create table tiles(id integer primary key,bounds text not null,done integer default 0,attempts integer default 0,error text);
      create table objects(id text primary key,body text not null,reason text,outcome text);`);
    db.prepare('insert into run values(?)').run(JSON.stringify({version:1,commune,snapshot}));
    const add=db.prepare('insert into tiles(bounds) values(?)');
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)add.run(JSON.stringify(
      [s+y*.1,w+x*.1,Math.min(n,s+(y+1)*.1),Math.min(e,w+(x+1)*.1)]));
    db.exec('commit');
  } catch(e){db.exec('rollback');throw e;}
}

function qualify(row) {
  const t=row.tags??{}, pos=row.type==='node'?row:row.center;
  if (t.natural!=='beach'||t.amenity||t.shop||t.highway||t.leisure==='beach_resort') return {reason:'not_beach'};
  if ([t.access,t.swimming].some(v=>['no','private'].includes(v))) return {reason:'restricted'};
  const name=(t['name:fr']??t.name??t.official_name);
  if (typeof name!=='string'||!name.trim()||name.length>300) return {reason:'unnamed'};
  if (!Number.isFinite(pos?.lat)||!Number.isFinite(pos?.lon)||Math.abs(pos.lat)>90||Math.abs(pos.lon)>180) return {reason:'invalid_point'};
  return {reason:null,name:name.trim(),lat:pos.lat,lon:pos.lon};
}
function parseTile(raw,snapshot) {
  const rows=raw?.elements, base=Date.parse(raw?.osm3s?.timestamp_osm_base);
  if (raw?.remark || !Array.isArray(rows) || !Number.isFinite(base) || base<Date.parse(snapshot)) throw Error('Incomplete source response');
  const end=rows.at(-1);
  if (end?.type!=='count' || !/^\d+$/.test(end.tags?.total) || Number(end.tags.total)!==rows.length-1) throw Error('Incomplete source count');
  const seen=new Set();
  return rows.slice(0,-1).map(row=>{
    if (!['node','way','relation'].includes(row?.type) || !Number.isSafeInteger(row.id) || row.id<1) throw Error('Invalid OSM identity');
    const id=row.type+'/'+row.id;
    if(seen.has(id))throw Error('Duplicate OSM identity');seen.add(id);
    return {id,...qualify(row)};
  });
}
function status(db) {
  const {commune,snapshot}=meta(db), tiles=db.prepare('select count(*) total,sum(done) done,count(error) errors from tiles').get();
  return {code:commune.code,commune:commune.nom,snapshot,tiles,complete:tiles.total===tiles.done,
    candidates:db.prepare('select count(*) n from objects where reason is null').get().n,
    exclusions:group(db.prepare('select reason key,count(*) n from objects where reason is not null group by reason').all()),
    outcomes:group(db.prepare('select outcome key,count(*) n from objects where outcome is not null group by outcome').all()),
    failedTiles:db.prepare('select id,bounds,attempts,error from tiles where error is not null order by id').all()};
}
async function collect(db,fetchTile) {
  const {snapshot}=meta(db), add=db.prepare('insert into objects(id,body,reason) values(?,?,?) on conflict(id) do nothing');
  for(const tile of db.prepare('select id,bounds from tiles where done=0 order by id').all()){
    try {
      const rows=parseTile(await fetchTile(JSON.parse(tile.bounds),snapshot),snapshot);
      db.exec('begin immediate');
      try {
        for(const r of rows){
          const body=JSON.stringify(r);
          if(!add.run(r.id,body,r.reason).changes && db.prepare('select body from objects where id=?').get(r.id).body!==body)
            throw Error('Conflicting source objects at the same snapshot');
        }
        db.prepare('update tiles set done=1,attempts=attempts+1,error=null where id=?').run(tile.id);
        db.exec('commit');
      } catch(e){db.exec('rollback');throw e;}
    } catch(e){
      const message=['Incomplete source count','Incomplete source response','Invalid OSM identity','Duplicate OSM identity',
        'Conflicting source objects at the same snapshot'].includes(e.message)||/^HTTP \d{3}$/.test(e.message)?e.message:'Collection unavailable';
      db.prepare('update tiles set error=?,attempts=attempts+1 where id=? and done=0').run(message,tile.id);
      throw Error('Tile '+tile.id+': '+message);
    }
  }
  return status(db);
}
async function getJson(url,options={}) {
  const res=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(35000),
    headers:{accept:'application/json','user-agent':'Littora catalogue (+https://github.com/ActuatorIO-Foundry/littora)',...options.headers}});
  if(!res.ok){await res.body?.cancel();throw Error('HTTP '+res.status);}
  return boundedJson(res,8*1024*1024);
}
async function fetchTile(bounds,snapshot) {
  const url=new URL(process.env.OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter');
  if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid provider configuration');
  await sleep(1200);
  const query='[out:json][timeout:25][date:"'+snapshot.replace('.000Z','Z')+'"];nwr["natural"="beach"]('+bounds.join(',')+');out center;out count;';
  return getJson(url,{method:'POST',body:new URLSearchParams({data:query})});
}

async function apply(db,pool,commit=false) {
  if(!status(db).complete)throw Error('Zone collection incomplete');
  const {commune}=meta(db);
  const candidates=db.prepare('select body from objects where reason is null order by id').all().map(r=>JSON.parse(r.body));
  const outcomes=await applyZone(pool,commune,candidates,commit);
  if(commit){
    db.exec('begin immediate');
    try{
      const save=db.prepare('update objects set outcome=? where id=?');
      for(const row of outcomes)save.run(row.outcome,row.id);
      db.exec('commit');
    }catch(e){db.exec('rollback');throw e;}
  }
  return outcomes;
}

async function main([command,dir,code,...extra]) {
  if(!['collect','status','review','preview','apply'].includes(command)||!dir||!codePattern.test(code)||extra.length)
    throw Error('Usage: catalogue-zone.cjs collect|status|review|preview|apply DIRECTORY INSEE');
  process.umask(0o077);
  const file=join(dir,code+'.sqlite');
  if(command==='collect')mkdirSync(dir,{recursive:true,mode:0o700});
  else if(!existsSync(file))throw Error('No local zone journal');
  const db=new DatabaseSync(file,{readOnly:['status','review','preview'].includes(command)});
  let pool;
  try{
    if(command==='collect'){
      if(!db.prepare("select name from sqlite_master where type='table' and name='run'").get()){
        const commune=await getJson('https://geo.api.gouv.fr/communes/'+code+'?fields=nom,code,departement,region,contour');
        if(commune.code!==code)throw Error('Commune identity mismatch');
        start(db,commune,new Date(Math.floor(Date.now()/1000-900)*1000).toISOString());
      }
    }
    if(meta(db).commune.code!==code)throw Error('Journal identity mismatch');
    if(command==='collect')await collect(db,fetchTile);
    if(command==='review')console.log(JSON.stringify(db.prepare('select id,reason,outcome from objects where reason is not null or outcome like ? or outcome in (?,?) order by id').all('review%','outside_france','outside_commune')));
    if(['preview','apply'].includes(command)){
      if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
      pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL});
      await assertCurrent(pool);
      const outcomes=await apply(db,pool,command==='apply');
      console.log(JSON.stringify({mode:command,outcomes:outcomes.reduce((m,r)=>({...m,[r.outcome]:(m[r.outcome]??0)+1}),{}),
        review:outcomes.filter(r=>r.outcome.startsWith('review')).map(r=>r.id)}));
    }
    console.log(JSON.stringify(status(db)));
  }finally{db.close();if(pool)await pool.end();}
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{console.error('{"event":"catalogue_operation_failed"}');process.exitCode=1;});
module.exports={start,parseTile,collect,status,apply,qualify};
