import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { conditionKey, searchConditions } from '../modules/search/search-conditions';

export const intervalMs = 15 * 60_000;
const slots = 7 * 24 * 4;
const usages = ['bathing','family','paddle','boat','catamaran','windsurf'] as const;
const counters = () => ({
  calculated:0, partial:0, insufficient:0, closed:0, 'not-applicable':0,
  reasons:{ noProjection:0, stale:0, missing:0, invalid:0 },
});
const slotKey = (slot:number) => 'ops:score-coverage:v1:'+slot;

type Site = {id:string;lat:number;lon:number;waterType:string;closed:boolean;airAt:Date|null;seaAt:Date|null};
export function summarize(sites:Site[], snapshots:(Record<string,any>|null)[], now:number) {
  if (!sites.length || sites.length!==snapshots.length) throw Error('Incomplete score coverage sample');
  const byUsage = Object.fromEntries(usages.map(u=>[u,counters()]));
  let noProjection=0, awaitingProjection=0;
  const scope=createHash('sha256');
  for (const [i,b] of sites.entries()) {
    scope.update(JSON.stringify([b.id,b.lat,b.lon,b.waterType])+'\n');
    const snap=snapshots[i];
    // Contributions change point totals, not the availability status. Never read contributor records here.
    const {explanations,conditions}=searchConditions(b,snap,now,b.closed);
    if(!conditions.calculatedAt) noProjection++;
    else if((b.airAt && b.airAt.getTime()>Date.parse(conditions.calculatedAt)) ||
            (b.seaAt && b.seaAt.getTime()>Date.parse(conditions.calculatedAt))) awaitingProjection++;
    for(const usage of usages){
      const e=explanations[usage], c=byUsage[usage];
      c[e.status]++;
      if(e.status!=='partial' && e.status!=='insufficient') continue;
      if(!conditions.calculatedAt) c.reasons.noProjection++;
      else {
        if(e.stale.length) c.reasons.stale++;
        if(e.missing.length) c.reasons.missing++;
        if(e.invalid.length) c.reasons.invalid++;
      }
    }
  }
  return {asOf:new Date(now).toISOString(),scope:scope.digest('hex'),sites:sites.length,
    marineSites:sites.filter(b=>b.waterType==='sea').length,noProjection,awaitingProjection,byUsage};
}

type Dispatch = {overdue:number;lastAttemptAt:Date|null;dispatchDelayed:boolean};
export function dispatchEvidence(sources:Dispatch[], now:number){
  if(sources.some(s=>s.dispatchDelayed)) return 'cooldown';
  if(!sources.some(s=>s.overdue>0)) return 'no-significant-backlog';
  return sources.some(s=>s.lastAttemptAt && now-s.lastAttemptAt.getTime()<300_000)
    ? 'backlog-with-recent-attempt' : 'backlog-without-recent-attempt';
}

export async function measure(db:Pool, redis:Redis) {
  const client=await db.connect();
  let sites:Site[], sources;
  try {
    await client.query('begin isolation level repeatable read read only');
    await client.query("set local statement_timeout='5s'");
    sites=(await client.query<Site>(`select b.id,b.lat,b.lon,b.water_type as "waterType",
      exists(select 1 from active_bathing_restrictions r where r.beach_id=b.id) as closed,
      a.last_success_at as "airAt",m.last_success_at as "seaAt"
      from beach_catalogue b left join forecast_zones a on a.source='open-meteo'
      and (a.y,a.x)=(floor(b.lat*100+.5)::int,floor(b.lon*100+.5)::int)
      left join forecast_zones m on b.water_type='sea' and m.source='open-meteo-marine'
      and (m.y,m.x)=(floor(b.lat*100+.5)::int,floor(b.lon*100+.5)::int) order by b.id`)).rows;
    sources=(await client.query(`select t.source,count(*)::int as zones,
      count(*) filter(where z.last_success_at is null)::int as "neverCollected",
      count(*) filter(where z.last_success_at<=now()-interval '6 hours')::int as stale,
      count(*) filter(where z.error_code is not null)::int as errors,
      count(*) filter(where z.next_check_at is null or z.next_check_at<=now())::int as due,
      count(*) filter(where z.next_check_at<now()-interval '5 minutes')::int as overdue,
      max(z.last_attempt_at) as "lastAttemptAt",max(z.last_success_at) as "lastSuccessAt",
      (select next_request_at>now() + interval '15 seconds' from forecast_dispatch where singleton) as "dispatchDelayed"
      from forecast_targets t left join forecast_zones z using(source,y,x) group by t.source order by t.source`)).rows;
    await client.query('commit');
  } catch(e) {await client.query('rollback');throw e;} finally {client.release();}
  const snapshots=[];
  for(let i=0;i<sites.length;i+=128){
    const values=await redis.mget(...sites.slice(i,i+128).map(b=>conditionKey(b.id)));
    for(const v of values) snapshots.push(v===null?null:JSON.parse(v));
  }
  const now=Date.now();
  return {...summarize(sites,snapshots,now),dispatch:dispatchEvidence(sources,now),sources};
}

export async function recordCoverage(db:Pool,redis:Redis){
  const sample=await measure(db,redis);
  const key=slotKey(Math.floor(Date.parse(sample.asOf)/intervalMs));
  await redis.set(key,JSON.stringify(sample),'EX',slots*intervalMs/1000,'NX');
  return {sites:sample.sites,asOf:sample.asOf};
}

export async function history(redis:Redis, count=slots, now=Date.now()){
  if(!Number.isSafeInteger(count)||count<1||count>slots) throw Error('Invalid history size');
  const end=Math.floor(now/intervalMs);
  const values=await redis.mget(...Array.from({length:count},(_,i)=>slotKey(end-count+1+i)));
  return values.map((v,i)=>({slot:new Date((end-count+1+i)*intervalMs).toISOString(),sample:v===null?null:JSON.parse(v)}));
}
