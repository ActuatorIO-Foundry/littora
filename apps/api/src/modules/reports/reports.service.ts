import { Inject, Injectable } from '@nestjs/common';
import { PG } from '../../database/database.module';
import { ContributionsService, ContributionIdentity } from './contributions.service';
import { normalizeReport, ReportInput } from './report-input';
import { flagConsensus } from './flag-consensus';

@Injectable()
export class ReportsService {
  constructor(@Inject(PG) private db: any, private contributions: ContributionsService) {}

  session(address?: string) { return this.contributions.session(address); }

  create(dto: ReportInput, identity: ContributionIdentity) {
    return this.contributions.submit(normalizeReport(dto), identity);
  }

  async list(beachId: string) {
    const { rows } = await this.db.query(
      `select r.*,c.observed_at,c.expires_at from reports r left join report_contributions c on c.report_id=r.id
       where beach_id=$1 and status='verified' and coalesce(r.value->>'demo','false')<>'true'
       and exists(select 1 from beach_catalogue b where b.id=r.beach_id)
       and coalesce(c.expires_at,r.created_at+interval '24 hours')>now()
       order by created_at desc limit 50`,
      [beachId],
    );
    return rows;
  }

  async aggregate(beachId: string) {
    const { rows } = await this.db.query(
      `select type,count(*)::int as count,avg(confidence)::float as confidence
       from reports
       where beach_id=$1
       and exists(select 1 from beach_catalogue b where b.id=reports.beach_id)
       and status='verified' and coalesce(value->>'demo','false')<>'true'
       and coalesce((select expires_at from report_contributions where report_id=reports.id),created_at+interval '24 hours')>now()
       and created_at > now() - interval '24 hours'
       group by type`,
      [beachId],
    );
    return rows;
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
}
