const assert=require('node:assert/strict');
const {test}=require('node:test');
const {parseAmenities,amenityCategory,fetchAmenities}=require('../dist/modules/beaches/amenities');
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
  try{await assert.rejects(fetchAmenities(position,'https://overpass-api.de/api/interpreter'),/unavailable/);}
  finally{global.fetch=original;}
  assert.equal(calls,1);
  const service=new AmenitiesService({});let loads=0;
  service.load=async()=>{loads++;await new Promise(r=>setTimeout(r,10));return {amenities:[]};};
  const first=service.get('id'),second=service.get('id');
  assert.deepEqual(await first,await second);assert.equal(loads,1);
});
