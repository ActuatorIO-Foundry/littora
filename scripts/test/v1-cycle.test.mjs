import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForCoverage } from '../check-v1-cycle.mjs';

const start='2026-11-18T18:00:00.000Z',scope='a'.repeat(32);
const reference={start,scope};
function row(minutes,finished=2) {
  return {at:new Date(Date.parse(start)+minutes*60000).toISOString(),scope,catalogueIds:'f'.repeat(64),
    sources:['open-meteo','open-meteo-marine'].map(source=>({source,targets:2,finished}))};
}
async function run(sequence,coverageMet=true,overrides={},mode='watch'){
  let calls=0,current;const sleeps=[];
  const result=await waitForCoverage(reference,{read:async()=>{assert.ok(sequence.length);current=sequence.shift();return current;},
    measure:async()=>{calls++;return {coverageMet,asOf:current.at,catalogueIds:current.catalogueIds,...overrides};},sleep:async ms=>sleeps.push(ms)},mode);
  return {result,calls,sleeps};
}
test('cycle: no public verdict before every target finishes and projections have had a TTL to refresh',async()=>{
  const {result,calls,sleeps}=await run([row(5,1),row(30),row(40),row(45),row(45)]);
  assert.equal(calls,1);assert.equal(sleeps.length,3);assert.equal(result.status,'measured');
  assert.equal(result.completedBy,row(30).at);assert.equal(result.public.coverageMet,true);
});
test('cycle: a real threshold failure remains visible after a complete sweep',async()=>{
  const {result}=await run([row(10),row(25),row(26)],false);assert.equal(result.public.coverageMet,false);
});
test('resume keeps the original cohort, bounds the new observation and waits a full projection TTL',async()=>{
  const {result,calls}=await run([row(860,1),row(865),row(875),row(880),row(881)],false,{},'resume');
  assert.equal(result.start,start);assert.equal(result.completedBy,row(865).at);assert.equal(calls,1);
  assert.equal(result.public.coverageMet,false);
  await assert.rejects(run([row(860,1),row(1340,1)],true,{},'resume'),/timed out/);
  await assert.rejects(run([{...row(860),scope:'b'.repeat(32)}],true,{},'resume'),/changed/);
});
test('cycle: no verdict on timeout, empty targets, catalogue drift, or a clock running backwards',async()=>{
  for(const other of [{asOf:start},{asOf:row(25).at},{catalogueIds:'0'.repeat(64)}])
    await assert.rejects(run([row(5),row(20),row(21)],true,other),/Public snapshot/);
  const changed={...row(20),scope:'b'.repeat(32)};
  for(const steps of [[row(480,1)],[{...row(0),sources:[]}],[changed],[row(5),row(20),changed],[row(-1)],[row(10,1),row(9,1)]]){
    await assert.rejects(run(steps));
  }
});
