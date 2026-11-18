import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../../database/database.module';
import { CacheService } from '../../cache/cache.service';
import { cacheKey, Cached, coastalDomains, currentVigilance } from './vigilance';

@Injectable()
export class AlertsService {
  constructor(@Inject(PG) private readonly db:Pool, private readonly cache:CacheService) {}

  async get(department?:string, beachId?:string) {
    if (department && beachId) throw new BadRequestException('Choose one geographic selector');
    if (beachId) {
      const beach = (await this.db.query('select lat,lon,water_type from beach_catalogue where id=$1',[beachId])).rows[0];
      if (!beach) throw new NotFoundException('Beach not found');
      if (beach.water_type === 'sea') {
        const candidates = coastalDomains.filter(({bbox:[w,s,e,n]}) =>
          w <= beach.lon && beach.lon <= e && s <= beach.lat && beach.lat <= n);
        if (candidates.length) {
          const {rows} = await this.db.query(`select distinct d.code from jsonb_to_recordset($1::jsonb) as d(code text, geometry jsonb)
            where ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON(d.geometry),4326),ST_SetSRID(ST_MakePoint($2,$3),4326))`,
            [JSON.stringify(candidates),beach.lon,beach.lat]);
          department = rows.length === 1 ? rows[0].code.slice(0,-2) : undefined;
        }
      }
    }
    const cached:Cached | null = !process.env.METEOFRANCE_API_KEY?.trim()
      ? {reason:'disabled'} : await this.cache.getJson<Cached>(cacheKey);
    return currentVigilance(cached,department);
  }
}
