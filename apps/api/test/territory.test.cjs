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

test('territory: invalid candidate coordinates are rejected before staging',()=>{
  const {qualify}=require('../scripts/catalogue-zone.cjs');
  for(const [lat,lon] of [[NaN,0],[Infinity,0],[91,0],[0,181]])assert.equal(qualify({
    type:'node',id:1,tags:{name:'Beach',natural:'beach'},lat,lon}).reason,'invalid_point');
});
