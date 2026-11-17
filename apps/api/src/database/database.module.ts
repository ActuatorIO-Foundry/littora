import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
const { assertCurrent } = require('../../scripts/database.cjs');
export const PG='PG_POOL';
@Global()
@Module({providers:[{provide:PG,useFactory:async () => {
  const pool = new Pool({connectionString:process.env.DATABASE_URL, connectionTimeoutMillis:5000});
  try {
    await assertCurrent(pool);
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}}],exports:[PG]})
export class DatabaseModule {}
