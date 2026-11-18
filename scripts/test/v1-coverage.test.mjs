import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectCoverage } from '../check-v1-coverage.mjs';

const asOf = '2026-11-18T09:00:00Z';
const fresh = { kind:'forecast', provider:'open-meteo', status:'partial', validAt:asOf, fetchedAt:asOf };
const beach = (id,waterType='sea',lat=41.6,lon=9.2) => ({
  id:String(id), waterType, lat, lon, airTemp:0, waterTemp:waterType==='sea'?0:null,
  conditions:{ weather:fresh, marine:waterType==='sea'?{...fresh,provider:'open-meteo-marine'}:null },
});
const page = (items,total=items.length,nextCursor=null) => ({
  items,total,asOf,pageInfo:{nextCursor,hasNextPage:nextCursor!==null},
});

test('V1 coverage: national snapshot includes all pages, six coasts, zeros and distinct freshwater sites',async()=>{
  const sites=[[50,1.6],[48,-4],[46,-1.2],[43,3.4],[43.2,6],[41.6,9.2]].map(([lat,lon],i)=>beach(i,'sea',lat,lon));
  sites.push(beach(6,'lake'),beach(7,'river'));
  const calls=[];
  const r=await inspectCoverage(async body=>{calls.push(body);return body.cursor?page(sites.slice(5),8):page(sites.slice(0,5),8,'two');});
  assert.deepEqual(calls,[{limit:200},{limit:200,cursor:'two'}]);
  assert.equal(r.total,8);assert.equal(r.air,8);assert.equal(r.seaTemperature,6);
  assert.equal(Object.keys(r.coasts).length,6);assert.equal(r.coverageMet,true);
});

test('V1 coverage: exact thresholds, unknown types and absent or stale values',async()=>{
  const sites=Array.from({length:10},(_,i)=>beach(i,i<5?'sea':i<9?'lake':'unknown'));
  sites[0].airTemp=null; sites[1].waterTemp=null;
  let r=await inspectCoverage(async()=>page(sites));
  assert.equal(r.checks.air90,true);assert.equal(r.checks.seaTemperature80,true);assert.equal(r.checks.classified90,true);
  sites[2].conditions={weather:{...fresh,status:'stale'},marine:{...fresh,fetchedAt:'2026-11-18T03:00:00Z'}};
  sites[8].waterType='unknown';sites[9].conditions.marine=fresh;
  r=await inspectCoverage(async()=>page(sites));
  for(const key of ['air90','seaTemperature80','classified90','noMarineOnNonSea']) assert.equal(r.checks[key],false,key);
  assert.equal(r.coverageMet,false);
  assert.equal((await inspectCoverage(async()=>page([]))).coverageMet,false);
});

test('V1 coverage: an expired, inconsistent or incomplete snapshot never yields a verdict',async()=>{
  for(const pages of [
    [page([beach(1)],2)],
    [page([beach(1)],2,'x'),page([beach(1)],2)],
    [page([beach(1)],3,'x'),page([beach(2)],3,'x')],
    [page([beach(1)],2,'x'),{...page([beach(2)],2),asOf:'2026-11-18T10:00:00Z'}],
    [page([{...beach(1),conditions:{}}])],
  ]) await assert.rejects(inspectCoverage(async()=>pages.shift()));
  await assert.rejects(inspectCoverage(async()=>{throw Error('HTTP 409');}),/409/);
});
