import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../database/database.module';
import { ForecastRow, readForecast, Source } from './forecast-data';

@Injectable()
export class ForecastStore {
  constructor(@Inject(PG) private readonly db: Pool) {}

  async get(source: Source, lat: number, lon: number) {
    const { rows } = await this.db.query<ForecastRow>(
      'select payload,last_success_at,next_check_at,error_code from forecast_zones where source=$1 and y=$2 and x=$3',
      [source, Math.round(lat*100), Math.round(lon*100)]);
    return readForecast(source, rows[0]);
  }
}
