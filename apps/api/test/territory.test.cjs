const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { metropolitanGeometry } = require('../scripts/prepare-territory.cjs');
const { BeachesService } = require('../dist/modules/beaches/beaches.service');

test('territory: snapshot identity, geometry and metropolitan components are validated', () => {
  const polygon = [[[2,48],[3,48],[2,49],[2,48]]];
  const corse = [[[8,42],[9,42],[8,43],[8,42]]];
  const overseas = [[[-62,16],[-61,16],[-62,17],[-62,16]]];
  const country = { osm_type:'relation',osm_id:2202162,type:'administrative',
    geojson:{type:'MultiPolygon',coordinates:[polygon,corse,overseas]} };
  assert.deepEqual(metropolitanGeometry([country]).coordinates,[polygon,corse]);
  assert.throws(()=>metropolitanGeometry([{...country,osm_id:1}]));
  assert.throws(()=>metropolitanGeometry([]));
  assert.throws(()=>metropolitanGeometry([{...country,geojson:{type:'MultiPolygon',coordinates:[[[[2,48],[2,16],[3,48],[2,48]]]]}}]));
  const sql=readFileSync(resolve(__dirname,'../migrations/0006_metropolitan_territory.sql'),'utf8');
  assert.ok(!/@SOURCE_SHA256@|@GEOMETRY@/.test(sql));
  assert.match(sql,/ST_Subdivide/);assert.match(sql,/USING gist/);
  assert.ok(!/\b(?:DELETE FROM|UPDATE public\.beaches|DROP TABLE)\b/i.test(sql));
});

test('territory: opt-in imports reject foreign or invalid positions before any write', async () => {
  let queries=0;
  const service=new BeachesService({query:async(sql,values)=>{
    queries++;
    assert.equal(sql,'select catalogue_in_metropolitan_france($1,$2) as included');
    assert.deepEqual(values,[50.8165,-0.123]);
    return {rows:[{included:false}]};
  }},{});
  assert.equal(await service.upsertDiscoveredBeach({osmId:'way/1',name:'Beach',lat:50.8165,lon:-0.123},'France','Manche'),null);
  for(const lat of [NaN,Infinity,91]) assert.equal(await service.upsertDiscoveredBeach({osmId:'way/1',name:'Beach',lat,lon:0},'France','Manche'),null);
  assert.equal(queries,1);
});
