import type { Pool } from 'pg';

export async function bathingEvidence(db:Pick<Pool,'query'>, beachId:string) {
  const official=await db.query(`select r.reference,r.authority,r.closed_on::text as "closedOn",r.closure_url as "closureUrl",
    r.lifted_on::text as "liftedOn",r.lift_url as "liftUrl", (a.reference is not null) as active
    from bathing_restrictions r join beach_catalogue b on b.id=r.beach_id
    left join active_bathing_restrictions a using (beach_id,reference) where r.beach_id=$1 order by r.closed_on desc,r.reference`,[beachId]);
  const restriction={status:official.rows.some(r=>r.active)?'closed':'unknown',decisions:official.rows};
  const linked=(await db.query('select code,name,season,release,sources from ars_linked_sites where beach_id=$1 order by season desc limit 1',[beachId])).rows[0];
  if(!linked)return {archive:null,restriction};
  const observations=(await db.query(`select product,observed::text as date,ended::text as end,data
    from ars_observations where release=$1 and code=$2 order by observed desc nulls last,identity`,[linked.release,linked.code])).rows;
  const samples=observations.filter(r=>r.product==='sample').map(r=>({date:r.date,...r.data}));
  const periods=(product:string)=>observations.filter(r=>r.product===product).map(r=>({from:r.date,to:r.end,kind:r.data.kind}));
  return {restriction,archive:{siteCode:linked.code,siteName:linked.name,season:linked.season,
    samplesUrl:linked.sources.samples.url,eventsUrl:linked.sources.events.url,classificationUrl:linked.sources.classes.url,
    classificationCode:observations.find(r=>r.product==='class')?.data.classificationCode??null,
    samples,historicalClosures:periods('closure'),historicalPollutions:periods('pollution')}};
}
