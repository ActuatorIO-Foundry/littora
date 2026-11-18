import { Pool } from 'pg';
import { prepareArchive } from './ars-archive';
import { matchSites, Beach } from './ars-match';
import { decodeResource, download, edition, products, Product, resources, season, sourceUrl } from './ars-source';

export async function importArs(pool:Pool, load:(p:Product)=>Promise<Buffer>=download) {
  const existing=async()=> (await pool.query('select stats from ars_releases where id=$1',[edition])).rows[0]?.stats;
  const previous=await existing();if(previous)return {imported:false,stats:previous};
  const csv={} as Record<Product,string[][]>;
  for(const p of products) csv[p]=decodeResource(p,await load(p));
  return publishArchive(pool,prepareArchive(csv));
}

export async function publishArchive(pool:Pool,archive:ReturnType<typeof prepareArchive>) {
  const client=await pool.connect();
  try {
    await client.query('begin');
    await client.query("set local lock_timeout='15s'");
    await client.query("set local statement_timeout='90s'");
    await client.query('select pg_advisory_xact_lock(18241,18)');
    const found=(await client.query('select stats from ars_releases where id=$1',[edition])).rows[0];
    if(found){await client.query('commit');return {imported:false,stats:found.stats};}
    const beaches=(await client.query<Beach>('select id,name,city,lat,lon,water_type from beach_catalogue')).rows;
    const matches=matchSites(archive.sites,beaches);
    const counts=(values:string[])=>values.reduce<Record<string,number>>((m,v)=>{m[v]=(m[v]??0)+1;return m;},{});
    const stats={season,sites:matches.length,matches:counts(matches.map(m=>m.status)),
      observations:counts(archive.observations.map(o=>o.product)),rejections:counts(archive.rejected.map(r=>r.reason))};
    const sources=Object.fromEntries(products.map(p=>[p,{url:sourceUrl(p),id:resources[p][0],sha256:resources[p][2]}]));
    await client.query('insert into ars_releases(id,season,sources,stats,rejected) values($1,$2,$3,$4,$5)',
      [edition,season,JSON.stringify(sources),JSON.stringify(stats),JSON.stringify(archive.rejected)]);
    const mapped=matches.map(m=>({...m.site,status:m.status,beach_id:m.beach?.id??null,evidence:m.beach,candidates:m.candidates}));
    await client.query(`insert into ars_sites select $1,code,insee,name,city,lat,lon,status,beach_id,evidence,candidates
      from jsonb_to_recordset($2::jsonb) as s(code text,insee text,name text,city text,lat float8,lon float8,status text,beach_id uuid,evidence jsonb,candidates jsonb)`,
      [edition,JSON.stringify(mapped)]);
    for(let i=0;i<archive.observations.length;i+=2000)await client.query(`insert into ars_observations
      select $1,code,product,identity,observed,ended,data from jsonb_to_recordset($2::jsonb)
      as o(code text,product text,identity text,observed date,ended date,data jsonb)`,[edition,JSON.stringify(archive.observations.slice(i,i+2000))]);
    await client.query('commit');return {imported:true,stats};
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}
