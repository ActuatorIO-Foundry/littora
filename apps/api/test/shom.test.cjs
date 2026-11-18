const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ports,matchPort}=require('../dist/modules/tides/shom-ports');
const {readHeight,readCurrent,references,ttl,shomKey}=require('../dist/modules/tides/shom-reference');
const {TidesService}=require('../dist/modules/tides/tides.service');
const {collectShom}=require('../dist/jobs/shom-collector');
const {schemaValidator}=require('../dist/http/contract');
const fixture=require('./fixtures/shom-calais.json');
const port=ports[0], now=Date.parse('2026-11-18T08:56:00Z');
const copy=structuredClone;
function memory() {
  const m=new Map;
  return {getJson:async k=>m.get(k)?.v??null,setJson:async(k,v,ttl)=>{m.set(k,{v,ttl});return true},m};
}

test('SHOM: real RAM identity and CRS84 location, no substitute for missing astronomical heights',()=>{
  const data=fixture.ram;
  assert.deepEqual(readHeight(data,port,now),{high:7.9,low:0.19,fetched:now});
  assert.equal(readHeight(data,ports[1],now),null);
  for(const edit of [f=>f.geometry.coordinates.reverse(),f=>f.properties.site='Brest',f=>f.properties.phma=null,f=>f.properties.pbma='']) {
    const d=copy(data);edit(d.features[0]);assert.equal(readHeight(d,port,now),null);
  }
  const negative=copy(data);negative.features[0].properties.pbma=-0.08;
  assert.equal(readHeight(negative,port,now).low,-0.08);
});
test('SHOM: unique VMAX polygon, zero class is not missing or an instantaneous current',()=>{
  const data=fixture.vmax;assert.equal(readCurrent(data,now).value,0.5);
  const zero=copy(data);zero.features[0].properties.vmax=0;assert.equal(readCurrent(zero,now).value,0);
  for(const d of [{...data,numberMatched:2},{...data,features:[]},{...data,numberReturned:0}]) assert.equal(readCurrent(d,now),null);
});
test('SHOM: no geographical extrapolation or unchecked harbor, predictions remain explicitly external',async()=>{
  assert.equal(matchPort(port.lat,port.lon,'Brest'),null);
  assert.equal(matchPort(0,0,'Calais'),null);
  assert.equal(matchPort(port.lat,port.lon,'calais').port,port);
  const api=new TidesService(memory());
  for(const coords of [[0,0],[port.lat,port.lon],[port.lat,port.lon,'Brest']]){
    const r=await api.get(...coords);assert.equal(r.status,'unknown');assert.equal(r.reliability,'unknown');
    assert.deepEqual(r.events,[]);assert.equal(r.currentReference,null);assert.equal(r.heightReference,null);
    assert.ok(schemaValidator('Tides')(r));
  }
  assert.equal((await api.get(port.lat,port.lon)).portReference.timetableUrl,'https://maree.shom.fr/harbor/CALAIS/');
});
test('SHOM: expiry is independent of midnight and no old day timetable is republished',()=>{
  const at=Date.parse('2026-07-14T21:59:00Z'), key=shomKey(port);
  const saved={station:key,height:readHeight(fixture.ram,port,at),current:readCurrent(fixture.vmax,at)};
  const nextDay=references(saved,port,at+120000);
  assert.equal(nextDay.heightReference.verticalDatum,'local-chart-datum');
  assert.equal(nextDay.currentReference.coefficient,95);
  assert.equal(references(saved,ports[1],at).heightReference,null);
  for(const t of [at-1,at+ttl*1000]) assert.deepEqual(references(saved,port,t),{heightReference:null,currentReference:null});
});
test('SHOM: worker uses only fixed public WFS, shares cache, handles denied, timeout and quota',async()=>{
  assert.equal(ports[Math.floor(now/60000)%ports.length],port);
  const cache=memory(), calls=[];
  const request=async(url,opts)=>{
    assert.equal(url.origin,'https://services.data.shom.fr');assert.equal(opts.redirect,'error');
    assert.deepEqual(opts.headers,{accept:'application/json'});assert.ok(opts.signal);
    calls.push(url);
    return Response.json(url.searchParams.has('filter') ? fixture.vmax : fixture.ram);
  };
  assert.equal(await collectShom(cache,request,now),'checked');
  assert.equal(calls[0].searchParams.get('resourceId'),port.ramId);
  assert.match(calls[1].searchParams.get('filter'),/1\.8675 50\.969333/);
  assert.equal((await cache.getJson(shomKey(port))).current.value,0.5);
  assert.equal(await collectShom(cache,request,now),'cached');assert.equal(calls.length,2);
  for(const status of [401,403,429,503]){
    const denied=memory();let n=0;
    assert.equal(await collectShom(denied,async()=>{n++;return new Response(null,{status,headers:{'Retry-After':'900'}})},now),'unavailable');
    assert.equal(n,1);
    assert.equal((await denied.getJson(shomKey(port))).height,null);
    if([429,503].includes(status)) assert.equal(await collectShom(denied,request,now+60000),'cooldown');
  }
  assert.equal(await collectShom(memory(),async()=>{throw Error('timeout')},now),'unavailable');
  const partial=memory();
  await collectShom(partial,async url=>url.searchParams.has('filter')?new Response(null,{status:503}):Response.json(fixture.ram),now);
  assert.equal((await partial.getJson(shomKey(port))).height.high,7.9);
  assert.equal((await partial.getJson(shomKey(port))).current,null);
});
