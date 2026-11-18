const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {createHash}=require('node:crypto');
const {migrate}=require('../../scripts/database.cjs');

test('coverage witness distinguishes leases, old success, finished failure, and a changed cohort',async()=>{
  const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.pathname,'/littora_ci_test');
  const pool=new Pool({connectionString:url.href});
  const since='2026-11-18T12:00:00Z',id='00000000-0000-4000-8000-000000000001';
  const sql=readFileSync(resolve(__dirname,'../../../../scripts/v1-forecast-cycle.sql'),'utf8').replaceAll(":'since'",'$1');
  try{
    await migrate(pool);
    const c=await pool.connect();
    try{
      await c.query('begin');
      await c.query('create temp table beach_catalogue as select id,lat,lon,water_type from public.beach_catalogue limit 0');
      await c.query('create temp table forecast_targets as select * from public.forecast_targets limit 0');
      await c.query('create temp table forecast_zones(like public.forecast_zones including defaults)');
      await c.query("insert into beach_catalogue values ($1,43,6,'sea')",[id]);
      await c.query("insert into forecast_targets values ('open-meteo',4300,600),('open-meteo-marine',4300,600)");
      const read=async()=>(await c.query(sql,[since])).rows[0].json_build_object;
      const before=await read();
      assert.equal(before.catalogueIds,createHash('sha256').update(id).digest('hex'));
      assert.deepEqual(before.sources.map(s=>s.finished),[0,0]);
      await c.query(`insert into forecast_zones(source,y,x,last_attempt_at,last_success_at,next_check_at,error_code)
        values('open-meteo',4300,600,$1::timestamptz-interval '1 second',$1::timestamptz+interval '1 second',$1::timestamptz+interval '6 hours',null),
          ('open-meteo-marine',4300,600,$1::timestamptz+interval '10 seconds',null,$1::timestamptz+interval '130 seconds','network')`,[since]);
      assert.deepEqual((await read()).sources.map(s=>[s.attempted,s.finished]),[[0,0],[1,0]]);
      await c.query("update forecast_zones set last_attempt_at=$1,last_success_at=$1 where source='open-meteo'",[since]);
      await c.query("update forecast_zones set next_check_at=last_attempt_at+interval '5 minutes',error_code='http_429' where source='open-meteo-marine'");
      const completed=await read();
      assert.deepEqual(completed.sources.map(s=>[s.finished,s.succeeded,s.errors]),[[1,1,0],[1,0,1]]);
      assert.equal(completed.scope,before.scope);
      await c.query('update beach_catalogue set lat=43.2');
      assert.notEqual((await read()).scope,before.scope);
      await c.query('update beach_catalogue set lat=43; update forecast_targets set x=x+1');
      assert.notEqual((await read()).scope,before.scope);
    }finally{await c.query('rollback');c.release();}
  }finally{await pool.end();}
});
