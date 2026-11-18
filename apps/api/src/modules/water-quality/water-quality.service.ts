import { Inject, Injectable } from '@nestjs/common';
import { PG } from '../../database/database.module';

type SampleRow = { date: string; result: string; source: string; age_days: number };

@Injectable()
export class WaterQualityService {
  constructor(@Inject(PG) private db: any) {}

  async get(beachId?: string, _lat?: number, _lon?: number) {
    let sample: SampleRow | undefined;
    if (beachId) {
      const { rows } = await this.db.query(`select w.sample_date::text as date, lower(trim(w.status)) as result,
          trim(w.source) as source, today - w.sample_date as age_days
        from water_quality w join beach_catalogue b on b.id=w.beach_id
        cross join (select (current_timestamp at time zone 'Europe/Paris')::date as today) clock
        where w.beach_id=$1 and not w.is_demo and lower(trim(w.source)) not in ('','unknown','local-seed','demo-seed')
          and coalesce(w.raw->>'demo','false') <> 'true'
          and w.sample_date <= today and nullif(trim(w.status),'') is not null
        order by w.sample_date desc, (lower(trim(w.status))='poor') desc, w.id limit 1`, [beachId]);
      sample = rows[0];
    }
    // A recent adverse sample warrants caution. No sample establishes permission to swim.
    const caution = sample?.result === 'poor' && sample.age_days <= 1;
    return {
      provider: sample?.source ?? 'unknown',
      status: caution ? 'poor' : 'unknown',
      classification: null,
      sample_date: sample?.date ?? null,
      lastSample: sample ? { date: sample.date, result: sample.result, source: sample.source } : null,
      reliability: caution ? 'recent-sample' : 'unknown',
      warning: caution ? 'Prélèvement récent défavorable. Vérifiez les consignes sur place.'
        : 'État sanitaire actuel non confirmé. Un prélèvement ne vaut pas autorisation de baignade.',
    };
  }
}
