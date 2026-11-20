import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { importArs } from './modules/water-quality/ars-import';
import { collectShom } from './jobs/shom-collector';
import { collectVigilance } from './jobs/vigilance-collector';
import { CacheService } from './cache/cache.service';
import { Queue, Worker } from 'bullmq';
import { rename, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DatabaseModule, PG } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { ScoreModule } from './modules/score/score.module';
import { ScoreService } from './modules/score/score.service';
import { collectOne, projectDue } from './jobs/forecast-collector';
import { intervalMs, recordCoverage } from './jobs/score-coverage';
import { CollectionSignals } from './jobs/collection-signals';
import { installFatalDiagnostics } from './shared/runtime-diagnostics';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, CacheModule, ScoreModule] })
class WorkerModule {}

const signals = new CollectionSignals();
async function start() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {logger:false, abortOnError:false});
  const db = app.get<Pool>(PG), scores = app.get(ScoreService);
  const url = process.env.JOBS_REDIS_URL || process.env.REDIS_URL;
  if (!url) throw new Error('Missing jobs Redis configuration');
  const connection = { url, maxRetriesPerRequest: null };
  const queue = new Queue('littora-weather', { connection });
  queue.on('error', () => signals.workerFailure('weather_queue'));
  const observationCache=process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:1,commandTimeout:4000,enableOfflineQueue:false}) : null;
  observationCache?.on('error',()=>signals.workerFailure('score_cache'));
  await queue.setGlobalConcurrency(1);
  for (const [name,every] of [['collect',15000],['project',60000],['vigilance',300000],['shom',60000],['score-coverage',intervalMs]] as const)
    await queue.upsertJobScheduler(name, { every }, { name, opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 200 } });
  const worker = new Worker(queue.name, job => signals.run(job.name, async () => {
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
    } finally {
      const heartbeat = '/tmp/littora-weather-heartbeat', staging = heartbeat + '.' + process.pid;
      await writeFile(staging, String(Date.now()), {mode: 0o600});
      await rename(staging, heartbeat);
    }
  }), { connection, concurrency: 1 });
  worker.on('failed', job => signals.jobFailure(job?.name));
  worker.on('error', () => signals.workerFailure('weather_queue'));
  // A seasonal release must not block short-lived weather collection jobs.
  const ars = process.env.ARS_IMPORT_ENABLED === 'true' ? new Worker('littora-ars', job=>signals.run(job.name,async ()=>{
    if(job.name!=='import')throw Error('Unknown ARS job');
    return importArs(db);
  }),{connection,concurrency:1}) : null;
  ars?.on('failed',job=>signals.jobFailure(job?.name));
  ars?.on('error',()=>signals.workerFailure('ars_queue'));
  const stop = async () => {
    await ars?.close();
    await worker.close(); await queue.close(); await observationCache?.quit(); await app.close(); await db.end();
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
installFatalDiagnostics('worker');
start().catch(() => { signals.workerFailure('startup'); process.exit(1); });
