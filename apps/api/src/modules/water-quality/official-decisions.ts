import { Pool } from 'pg';
import { officialDate } from './ars-source';

// A verified registry is supplied by the operator, never by a public request.
function publisherFor(host:string,insee:string) {
  const extra:unknown=JSON.parse(process.env.ARS_APPROVED_AUTHORITIES??'[]');
  if(!Array.isArray(extra))throw Error('Invalid authority registry');
  const all=[{host:'www.bandol.fr',insee:'83009',authority:'Ville de Bandol'},...extra];
  const records=all.filter(p=>p?.host===host && p.insee===insee && typeof p.authority==='string' && p.authority.trim().length>0);
  return records.length===1?records[0]:null;
}
export async function recordDecision(pool:Pool,event:{action:string;beachId:string;reference:string;day:string;source:string}) {
  const {action,beachId,reference,day,source}=event;
  const url=new URL(source);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname==='/'||
    !['close','lift'].includes(action)||!/^[-A-Za-z0-9./_]{1,120}$/.test(reference)||
    !/^\d{4}-\d{2}-\d{2}$/.test(day)||officialDate(day.split('-').reverse().join('/'))!==day)throw Error('Invalid official decision');
  const c=await pool.connect();
  try{
    await c.query('begin');
    const eligible=(await c.query("select $1::date<=(now() at time zone 'Europe/Paris')::date as valid",[day])).rows[0].valid;
    if(!eligible)throw Error('Future decision');
    await c.query('select pg_advisory_xact_lock(hashtext($1),18)',[beachId]);
    const prior=(await c.query('select authority,closed_on::text,lifted_on::text,closure_url,lift_url from bathing_restrictions where beach_id=$1 and reference=$2',[beachId,reference])).rows[0];
    if(action==='close'){
      const b=(await c.query('select insee from ars_linked_sites where beach_id=$1 order by season desc limit 1',[beachId])).rows[0];
      const publisher=b && publisherFor(url.hostname,b.insee);
      if(!publisher)throw Error('Unverified scope or authority');
      if(!prior)await c.query('insert into bathing_restrictions(beach_id,reference,authority,closed_on,closure_url) values($1,$2,$3,$4,$5)',
        [beachId,reference,publisher.authority,day,source]);
      else if(prior.closed_on!==day||prior.closure_url!==source)throw Error('Conflicting closure evidence');
    }else{
      if(!prior||new URL(prior.closure_url).hostname!==url.hostname||day<prior.closed_on||(prior.lifted_on&&(prior.lifted_on!==day||prior.lift_url!==source)))throw Error('No corresponding closure or conflicting lift');
      if(!prior.lifted_on)await c.query('update bathing_restrictions set lifted_on=$3,lift_url=$4 where beach_id=$1 and reference=$2',[beachId,reference,day,source]);
    }
    await c.query('commit');
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
}
