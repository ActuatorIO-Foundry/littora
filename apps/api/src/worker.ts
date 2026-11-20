import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { importArs } from './modules/water-quality/ars-import';
import { collectShom } from './jobs/shom-collector';
import { collectVigilance } from './jobs/vigilance-collector';
import { CacheService } from './cache/cache.service';
import { Queue, Worker } from 'bullmq';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DatabaseModule, PG } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { ScoreModule } from './modules/score/score.module';
import { ScoreService } from './modules/score/score.service';
import { collectOne, projectDue } from './jobs/forecast-collector';
import { intervalMs, recordCoverage } from './jobs/score-coverage';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, CacheModule, ScoreModule] })
class WorkerModule {}

async function start() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const db = app.get<Pool>(PG), scores = app.get(ScoreService);
  const url = process.env.JOBS_REDIS_URL || process.env.REDIS_URL;
  if (!url) throw new Error('Missing jobs Redis configuration');
  const connection = { url, maxRetriesPerRequest: null };
  const queue = new Queue('littora-weather', { connection });
  const observationCache=process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:1,commandTimeout:4000,enableOfflineQueue:false}) : null;
  observationCache?.on('error',()=>console.error('Score coverage cache unavailable'));
  await queue.setGlobalConcurrency(1);
  for (const [name,every] of [['collect',15000],['project',60000],['vigilance',300000],['shom',60000],['score-coverage',intervalMs]] as const)
    await queue.upsertJobScheduler(name, { every }, { name, opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 200 } });
  const worker = new Worker(queue.name, async job => {
    try {
      if (job.name === 'score-coverage') {
        if(!observationCache) throw Error('Score coverage cache not configured');
        return await recordCoverage(db,observationCache);
      }
      if (job.name === 'shom') return await collectShom(app.get(CacheService));
      if (job.name === 'vigilance') return await collectVigilance(app.get(CacheService));
      if (job.name === 'collect') return await collectOne(db);
      if (job.name === 'project') return await projectDue(db,scores);
      throw new Error('Unknown weather job');
    } finally { await writeFile('/tmp/littora-weather-heartbeat', String(Date.now())); }
  }, { connection, concurrency: 1 });
  worker.on('failed', (job,e) => console.error('Weather job failed', job?.id, e.message));
  worker.on('error', e => console.error('Weather queue unavailable', e.name));
  // A seasonal release must not block short-lived weather collection jobs.
  const ars = process.env.ARS_IMPORT_ENABLED === 'true' ? new Worker('littora-ars', async job=>{
    if(job.name!=='import')throw Error('Unknown ARS job');
    return importArs(db);
  },{connection,concurrency:1}) : null;
  ars?.on('failed',()=>console.error('ARS import failed; no partial release published'));
  ars?.on('error',()=>console.error('ARS queue unavailable'));
  const stop = async () => {
    await ars?.close();
    await worker.close(); await queue.close(); await observationCache?.quit(); await app.close(); await db.end();
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
start().catch(e => { console.error('Weather worker startup failed', e.name); process.exit(1); });
