import { Inject, Injectable } from '@nestjs/common';
import { PG } from '../../database/database.module';

@Injectable()
export class WaterQualityService {
  constructor(@Inject(PG) private db: any) {}

  async get(beachId?: string, lat?: number, lon?: number) {
    if (beachId) {
      const { rows } = await this.db.query(`select * from water_quality
        where beach_id=$1 and is_demo=false
        and exists(select 1 from beach_catalogue b where b.id=water_quality.beach_id)
        and coalesce(source,'') not in ('local-seed','demo-seed')
        and coalesce(raw->>'demo','false') <> 'true'
        order by sample_date desc limit 1`, [beachId]);
      if (rows[0]) return { ...rows[0], provider: rows[0].source || 'local-cache' };
    }
    return {
      provider: 'baignades-sante/data-gouv-ready', status: 'unknown', classification: null,
      reliability: 'unknown', warning: 'No verified bathing-water sample available.',
    };
  }
}
