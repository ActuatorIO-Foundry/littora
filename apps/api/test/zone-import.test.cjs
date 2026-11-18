const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {start,collect,status,parseTile}=require('../scripts/catalogue-zone.cjs');


const commune={code:'83009',nom:'Bandol',departement:{nom:'Var'},region:{nom:'Provence'},contour:{
  type:'Polygon',coordinates:[[[5.7,43.1],[5.81,43.1],[5.81,43.15],[5.7,43.15],[5.7,43.1]]]}};
const snapshot='2026-01-01T00:00:00.000Z';
const element=id=>({type:'node',id,tags:{natural:'beach',name:'B'+id},lat:43.13,lon:5.73});
const reply=elements=>({osm3s:{timestamp_osm_base:snapshot},elements:[...elements,{type:'count',tags:{total:String(elements.length)}}]});

test('zone collection: a failed tile is retried, successful tiles are not repeated; no 140/200/500 cap',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  start(db,commune,snapshot);
  let n=0;const rows=Array.from({length:601},(_,i)=>element(100+i));
  await assert.rejects(collect(db,async()=>{if(n++===0)return reply(rows);throw Error('provider unavailable');}));
  assert.equal(status(db).complete,false);assert.equal(status(db).tiles.done,1);
  assert.equal(status(db).tiles.errors,1);
  let retries=0;await collect(db,async()=>{retries++;return reply([rows[0],{...element(9999),tags:{natural:'beach',shop:'yes'}}]);});
  const report=status(db);assert.equal(report.complete,true);assert.equal(report.candidates,601);
  assert.equal(report.exclusions['not_beach'],1);
  assert.equal(retries,report.tiles.total-1);
  await collect(db,()=>assert.fail('already complete'));
});

test('zone collection: reject incomplete, stale or duplicate source payloads before checkpointing',()=>{
  const good=reply([element(1)]);
  for(const body of [{...good,remark:'timeout'},{...good,elements:good.elements.slice(0,1)},
    {...good,osm3s:{timestamp_osm_base:'2025-01-01T00:00:00Z'}},reply([element(1),element(1)])]){
    assert.throws(()=>parseTile(body,snapshot));
  }
  assert.equal(parseTile(reply([]),snapshot).length,0);
});

test('refuse an incomplete batch before opening PostgreSQL and reject incompatible journal versions',async t=>{
  const {apply}=require('../scripts/catalogue-zone.cjs');
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  start(db,commune,snapshot);
  await assert.rejects(apply(db,{connect:()=>assert.fail('no PostgreSQL connection')},true),/incomplete/);
  db.prepare('update run set body=?').run(JSON.stringify({version:2,commune,snapshot}));
  assert.throws(()=>status(db),/journal/i);
});
