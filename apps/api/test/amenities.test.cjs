const assert=require('node:assert/strict');
const {test}=require('node:test');
const {parseAmenities,amenityCategory,fetchAmenities,failureReason}=require('../dist/modules/beaches/amenities');
const {validate,covers,importCity}=require('../scripts/amenities.cjs');
const {AmenitiesService}=require('../dist/modules/beaches/amenities.service');
const {BeachesService}=require('../dist/modules/beaches/beaches.service');
const position={lat:43,lon:6};
const node=(id,lat=43,lon=6,tags={amenity:'parking'})=>({type:'node',id,lat,lon,tags:{name:'Parking de la plage',...tags}});

test('amenities: identity deduplication, actual distance, no invented points or silent truncation',()=>{
  const points=[node(1),node(2,43.001),node(1),node(3,43.035)];
  const result=parseAmenities({elements:points},position);
  assert.deepEqual(result.map(p=>p.id),['node/1','node/2']);
  assert.equal(result[0].distanceKm,0);
  assert.equal(result[0].name,result[1].name);
  assert.deepEqual(parseAmenities({elements:[]},position),[]);
  assert.equal(parseAmenities({elements:Array.from({length:50},(_,i)=>node(i+1))},position).length,50);
  assert.throws(()=>parseAmenities({remark:'timeout',elements:[node(1)]},position));
  assert.throws(()=>parseAmenities({},position));
});

test('amenities: structured tags do not turn sports into rentals or a station into active supervision',()=>{
  assert.equal(amenityCategory({sport:'surf'}),null);
  assert.equal(amenityCategory({shop:'sports'}),null);
  assert.equal(amenityCategory({leisure:'marina'}),null);
  assert.equal(amenityCategory({amenity:'parking',access:'private'}),null);
  assert.equal(amenityCategory({amenity:'parking',disused:'yes'}),null);
  assert.equal(amenityCategory({amenity:'boat_rental'}),'rental');
  assert.equal(amenityCategory({emergency:'lifeguard'}),'rescue');
  const row={id:'test',lat:43,lon:6,has_parking:true,has_toilets:false,has_lifeguard:true};
  const result=new BeachesService({},{}).enrichBeach(row);
  assert.equal(result.has_parking,null);
  assert.equal(result.has_lifeguard,null);
  assert.equal(result.facilities.toilets.status,'unknown');
});

test('amenities: failed source and legacy flags never produce a geolocated fallback',async()=>{
  const previous=process.env.OVERPASS_API_URL;
  process.env.OVERPASS_API_URL='https://overpass.osm.ch/api/interpreter';
  const queries=[];
  try{
    const service=new AmenitiesService({query:async(sql)=>{
      queries.push(sql);
      return {rows:sql.startsWith('select id,lat,lon')?[{id:'test',...position,has_parking:true}]:[]};
    }});
    const result=await service.get('test');
    assert.deepEqual(result.amenities,[]);
    assert.equal(result.status,'unknown');
    assert.equal(result.total,0);
    assert.ok(queries.some(q=>q.includes('error_code')));
    assert.ok(!queries.some(q=>q.startsWith('insert into beaches')));
  }finally{if(previous===undefined)delete process.env.OVERPASS_API_URL;else process.env.OVERPASS_API_URL=previous;}
});

test('amenities: unavailable provider is bounded and simultaneous requests share a collection',async()=>{
  const original=global.fetch;let calls=0;
  global.fetch=async(_url,init)=>{calls++;assert.ok(init.signal);return {ok:false,status:429};};
  try{await assert.rejects(fetchAmenities(position,'https://overpass-api.de/api/interpreter'),/rate-limit/);}
  finally{global.fetch=original;}
  assert.equal(calls,1);
  const service=new AmenitiesService({});let loads=0;
  service.load=async()=>{loads++;await new Promise(r=>setTimeout(r,10));return {amenities:[]};};
  const first=service.get('id'),second=service.get('id');
  assert.deepEqual(await first,await second);assert.equal(loads,1);
});

test('amenities: provider diagnostics do not expose exception details',()=>{
  assert.equal(failureReason(new DOMException('private request data','TimeoutError')),'timeout');
  assert.equal(failureReason(new Error('unfiltered internal details')),'transport');
  assert.equal(failureReason(new SyntaxError('raw provider body')),'invalid-response');
  assert.equal(failureReason(new Error('upstream')),'upstream');
});

test('amenities: offline preview rejects stale, malformed or out-of-scope data without any writes',async()=>{
  const asOf=new Date(Date.now()-3600000).toISOString();
  const doc={version:1,asOf,source:'https://download.openstreetmap.fr/extracts/europe/france/paca/var-latest.osm.pbf',
    bounds:[42.9,5.9,43.1,6.1],elements:[{...node(1),timestamp:asOf}]};
  assert.equal(validate(doc),doc);
  for(const invalid of [{asOf:new Date(Date.now()-49*3600000).toISOString()},{asOf:'2999-01-01'},
    {source:'https://example.com/var-latest.osm.pbf'},{bounds:[42,5,44,7]},
    {elements:[...doc.elements,...doc.elements]},{elements:[{...doc.elements[0],lat:45}]}])
    assert.throws(()=>validate({...doc,...invalid}));
  assert.ok(covers(doc.bounds,position));assert.equal(covers(doc.bounds,{lat:43.099,lon:6}),false);
  const db={query:async(sql)=>{assert.match(sql,/^select id,lat,lon from beach_catalogue/);
    return {rows:[{id:'a',...position},{id:'b',lat:43.099,lon:6},{id:'c',lat:43.06,lon:6}]};}};
  const report=await importCity(db,'Commune',doc,false);
  assert.deepEqual(report,{sites:3,edge:1,withoutPoints:1,withPoints:1,associations:1,updated:0,preserved:0,asOf});
  assert.equal((await importCity(db,'Commune',{...doc,elements:[]},true)).updated,0);
});
