import { Inject, Injectable } from '@nestjs/common';
import { PG } from '../../database/database.module';
import { ContributionsService, ContributionIdentity } from './contributions.service';
import { normalizeReport, ReportInput } from './report-input';
import { flagConsensus } from './flag-consensus';
import { createHash } from 'node:crypto';

@Injectable()
export class ReportsService {
  constructor(@Inject(PG) private db: any, private contributions: ContributionsService) {}

  session(address?: string) { return this.contributions.session(address); }

  create(dto: ReportInput, identity: ContributionIdentity) {
    return this.contributions.submit(normalizeReport(dto), identity);
  }

  async list(beachId: string) {
    const { rows } = await this.db.query(
      `select r.*,coalesce(c.observed_at,r.created_at) as observed_at,
       coalesce(c.expires_at,r.created_at+interval '24 hours') as expires_at from reports r left join report_contributions c on c.report_id=r.id
       where beach_id=$1 and status='verified' and coalesce(r.value->>'demo','false')<>'true'
       and exists(select 1 from beach_catalogue b where b.id=r.beach_id)
       and coalesce(c.expires_at,r.created_at+interval '24 hours')>now()
       and coalesce(c.observed_at,r.created_at)<=now()
       order by observed_at desc,r.id limit 50`,
      [beachId],
    );
    return rows;
  }

  async aggregate(beachId: string) {
    return (await this.activeCommunity([beachId])).byBeach.get(beachId.toLowerCase()) ?? [];
  }

  async activeCommunity(beachIds?: string[]) {
    const {rows}=await this.db.query(`select r.beach_id,r.type,count(*)::int as count,
      avg(r.confidence)::float as confidence,md5(string_agg(r.id::text || case
        when r.type <> 'flag' then ''
        when coalesce(c.observed_at,r.created_at)>now()-interval '3 hours' and c.contributor_id is not null
          and c.network_hash is not null then 'vote'
        when coalesce(c.observed_at,r.created_at)>now()-interval '12 hours' then 'history'
        else 'inactive' end,',' order by r.id)) as stamp
      from reports r left join report_contributions c on c.report_id=r.id
      where r.status='verified' and r.created_at>now()-interval '24 hours' and coalesce(r.value->>'demo','false')<>'true'
        and coalesce(c.observed_at,r.created_at)<=now() and coalesce(c.expires_at,r.created_at+interval '24 hours')>now()
        and ($1::uuid[] is null or r.beach_id=any($1)) and exists(select 1 from beach_catalogue b where b.id=r.beach_id)
      group by r.beach_id,r.type order by r.beach_id,r.type`,[beachIds ?? null]);
    const byBeach=new Map<string,Array<{type:string;count:number;confidence:number}>>();
    const digest=createHash('sha256');
    for(const {beach_id,type,count,confidence,stamp} of rows){
      digest.update(JSON.stringify([beach_id,type,count,confidence,stamp]));
      const group=byBeach.get(beach_id) ?? [];
      group.push({type,count,confidence});byBeach.set(beach_id,group);
    }
    return {key:digest.digest('hex'),byBeach};
  }

  async flagConsensus(beachId: string) {
    const { rows } = await this.db.query(
      `select r.id,r.value,r.status,r.created_at,c.observed_at,c.expires_at,c.contributor_id,c.network_hash
       from reports r left join report_contributions c on c.report_id=r.id
       where beach_id=$1 and type='flag'
       and exists(select 1 from beach_catalogue b where b.id=r.beach_id)
       and status='verified' and coalesce(value->>'demo','false')<>'true'
       and coalesce(c.expires_at,created_at+interval '24 hours')>now()
       and coalesce(c.observed_at,created_at) > now() - interval '12 hours'
       and coalesce(c.observed_at,created_at)<=now() and created_at<=now()
       order by coalesce(c.observed_at,created_at) desc,r.id
       limit 1001`,
      [beachId],
    );

    return flagConsensus(rows);
  }

  async flagConsensuses(beachIds: string[]) {
    const result = new Map<string, ReturnType<typeof flagConsensus>>();
    if (!beachIds.length) return result;
    const { rows } = await this.db.query(`select * from (
        select r.beach_id,r.id,r.value,r.status,r.created_at,c.observed_at,c.expires_at,c.contributor_id,c.network_hash,
          row_number() over(partition by r.beach_id order by coalesce(c.observed_at,r.created_at) desc,r.id) as rank
        from reports r join beach_catalogue b on b.id=r.beach_id
        left join report_contributions c on c.report_id=r.id
        where r.beach_id=any($1::uuid[]) and r.type='flag' and r.status='verified'
        and coalesce(r.value->>'demo','false')<>'true'
        and coalesce(c.expires_at,r.created_at+interval '24 hours')>now()
        and coalesce(c.observed_at,r.created_at)>now()-interval '12 hours'
        and coalesce(c.observed_at,r.created_at)<=now() and r.created_at<=now()
      ) observations where rank<=1001`, [beachIds]);
    const groups = new Map<string, any[]>();
    for (const row of rows) {
      const group = groups.get(row.beach_id) ?? [];
      group.push(row); groups.set(row.beach_id,group);
    }
    for (const [id, group] of groups) result.set(id,flagConsensus(group));
    return result;
  }
}
