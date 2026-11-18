import { haversineKm } from '../../shared/geo';
export type Site = {code:string;name:string;city:string;insee:string;lat:number;lon:number;water:string};
export type Beach = {id:string;name:string;city:string|null;lat:number;lon:number;water_type:string};
const normal=(s:string|null)=>(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const beachName=(s:string)=>normal(s).split(' ').filter(w=>!['plage','anse','la','le','les','de','du','des','d','l'].includes(w)).join(' ');
export function matchSites(sites:Site[], beaches:Beach[]) {
  const claims=new Map<string,number>();
  const result=sites.map(site=>{
    const candidates=beaches.filter(b=>Math.abs(site.lat-b.lat)<0.01 && Math.abs(site.lon-b.lon)<0.02)
      .map(b=>({b,m:haversineKm(site.lat,site.lon,b.lat,b.lon)*1000})).filter(c=>c.m<=500).sort((a,b)=>a.m-b.m);
    const sameName=candidates.filter(({b})=>beachName(site.name)!=='' && beachName(site.name)===beachName(b.name));
    for(const {b,m} of sameName)if(m<=200 && normal(site.city)===normal(b.city) && site.water===b.water_type)
      claims.set(b.id,(claims.get(b.id)??0)+1);
    const only=sameName.length===1?sameName[0]:null;
    const match=only && only.m<=200 && normal(site.city)===normal(only.b.city) && site.water===only.b.water_type && site.water!=='unknown'?only.b:null;
    return {site,beach:match,status:match?'matched':candidates.length?'review':'unmatched',
      candidates:candidates.map(({b,m})=>({id:b.id,distanceMeters:Math.round(m)}))};
  });
  for(const r of result)if(r.beach && (claims.get(r.beach.id)??0)>1){r.beach=null;r.status='review';}
  return result;
}
