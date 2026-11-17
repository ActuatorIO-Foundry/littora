import { Inject, Injectable } from '@nestjs/common';
import { PG } from '../../database/database.module';
import { ContributionsService, ContributionIdentity } from './contributions.service';
import { normalizeReport, ReportInput } from './report-input';

type Flag = 'green' | 'yellow' | 'red';

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
      `select value,confidence,created_at
       from reports
       where beach_id=$1
       and type='flag'
       and status='verified' and coalesce(value->>'demo','false')<>'true'
       and coalesce((select expires_at from report_contributions where report_id=reports.id),created_at+interval '24 hours')>now()
       and created_at > now() - interval '12 hours'
       order by created_at desc
       limit 80`,
      [beachId],
    );

    const scores: Record<Flag, number> = { green: 0, yellow: 0, red: 0 };
    const counts: Record<Flag, number> = { green: 0, yellow: 0, red: 0 };
    const history: Array<{ flag: Flag; time: string; confidence: number }> = [];

    for (const row of rows) {
      const flag = this.normalizeFlag(row.value?.flag ?? row.value?.drapeau ?? row.value?.value);
      if (!flag) continue;

      const ageHours = Math.max(0, (Date.now() - new Date(row.created_at).getTime()) / 36e5);
      const recency = Math.max(0.2, 1 - ageHours / 12);
      const confidence = Math.min(1, Math.max(0.1, Number(row.confidence ?? 0.5)));
      const criticalBoost = flag === 'red' && ageHours < 1 ? 1.35 : 1;
      scores[flag] += confidence * recency * criticalBoost;
      counts[flag] += 1;
      history.push({ flag, time: row.created_at, confidence });
    }

    const ranked = (Object.keys(scores) as Flag[]).sort((a, b) => scores[b] - scores[a]);
    const flag = ranked[0];
    const total = scores.green + scores.yellow + scores.red;
    if (!total || scores[flag] <= 0) return null;

    return {
      flag,
      confidence: Number((scores[flag] / total).toFixed(2)),
      counts,
      history: history.slice(0, 12),
      scores,
    };
  }

  private normalizeFlag(value: unknown): Flag | null {
    const flag = String(value ?? '').toLowerCase();
    if (['green', 'vert', 'verte'].includes(flag)) return 'green';
    if (['yellow', 'jaune', 'orange'].includes(flag)) return 'yellow';
    if (['red', 'rouge'].includes(flag)) return 'red';
    return null;
  }
}
