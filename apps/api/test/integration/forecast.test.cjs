require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { resolve } = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { Pool } = require('pg');
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const { migrate } = require('../../scripts/database.cjs');
const { collectOne } = require('../../dist/jobs/forecast-collector');
const { ForecastStore } = require('../../dist/shared/forecast-store');
const { conditionKey } = require('../../dist/modules/search/search-conditions');

async function until(check) {
  for (let i=0;i<160;i++) { if (await check()) return; await sleep(250); }
  assert.fail('Timed out waiting for worker');
}

test('weather worker: shared collection, search projection, restart, durable cooldown and unchanged catalogue',async t=>{
  const url = new URL(process.env.TEST_DATABASE_URL), redisUrl=process.env.TEST_REDIS_URL;
  assert.equal(url.pathname,'/littora_ci_test'); assert.equal(new URL(redisUrl).pathname,'/15');
  const admin=new Pool({connectionString:url.href}), name='littora_ci_weather_'+randomUUID().replaceAll('-','');
  await admin.query(`create database "${name}" template template0`);
  url.pathname='/'+name;
  const pool=new Pool({connectionString:url.href}), redis=new Redis(redisUrl);
  const queue=new Queue('littora-weather',{connection:{url:redisUrl}});
  const ids=[randomUUID(),randomUUID()];
  let worker;
  const stop=async()=>{
    if(worker && worker.exitCode===null && worker.signalCode===null){
      const exited=once(worker,'exit');worker.kill('SIGTERM');await exited;
    }
    worker=undefined;
  };
  t.after(async()=>{
    await stop();await queue.obliterate({force:true});await queue.close();
    await redis.del(...ids.map(conditionKey));await redis.quit();await pool.end();
    try{await admin.query(`drop database "${name}"`);}finally{await admin.end();}
  });
  await migrate(pool);
  await pool.query(`insert into beaches(id,name,lat,lon) values ($1,'First',43,6),($2,'Second',43.001,6.001)`,ids);
  assert.equal((await pool.query('select * from forecast_targets')).rowCount,1,'Shared air zone, no marine collection on unclassified sites');
  const catalogue=async()=>(await pool.query('select to_jsonb(b) item from beaches b order by id')).rows;
  const before=await catalogue();
  const start=()=>{
    worker=spawn(process.execPath,['--require',resolve(__dirname,'../fixtures/worker-provider.cjs'),resolve(__dirname,'../../dist/worker.js')],
      { env:{...process.env,DATABASE_URL:url.href,REDIS_URL:redisUrl,JOBS_REDIS_URL:redisUrl},stdio:'ignore' });
  };
  start();
  await until(async()=>(await pool.query('select 1 from forecast_zones where last_success_at is not null')).rowCount===1);
  await queue.add('project',{}); // Exercise the real processor without waiting for its minute tick.
  await until(async()=>(await redis.mget(...ids.map(conditionKey))).every(v=>v && JSON.parse(v).airTemp===17));
  await stop();
  const store=new ForecastStore(pool);
  const first=await store.get('open-meteo',43,6);
  assert.equal(first.current.temperature_2m,17);
  assert.equal((await store.get('open-meteo',43.001,6.001)).fetchedAt,first.fetchedAt);
  assert.equal((await store.get('open-meteo-marine',43,6)).status,'unknown');
  start();const job=await queue.add('collect',{});
  await until(async()=>await job.getState()==='completed');await stop();
  assert.equal((await store.get('open-meteo',43,6)).fetchedAt,first.fetchedAt);
  await pool.query(`update forecast_zones set next_check_at=now(); update forecast_dispatch set next_request_at=now()`);
  let calls=0;
  const request=async()=>{calls++;return new Response(null,{status:429,headers:{'Retry-After':'900'}});};
  const result=await Promise.allSettled([collectOne(pool,request),collectOne(pool,request)]);
  assert.equal(calls,1);assert.equal(result.filter(r=>r.status==='rejected').length,1);
  const stale=await store.get('open-meteo',43,6);
  assert.equal(stale.status,'stale');assert.equal(stale.fetchedAt,first.fetchedAt);
  assert.ok(Date.parse(stale.nextCheckAt)>Date.now()+890000);
  assert.deepEqual(await collectOne(pool,request),{collected:0});
  assert.deepEqual(await catalogue(),before);
});
