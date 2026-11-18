const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBulletin, currentVigilance, cacheKey } = require('../dist/modules/alerts/vigilance');
const { collectVigilance } = require('../dist/jobs/vigilance-collector');
const { schemaValidator } = require('../dist/http/contract');
const fixture = require('./fixtures/meteofrance-vigilance-20261118.json');
const at = t => Date.parse('2026-11-18T'+t+'Z');
const select = (doc,dept,now) => currentVigilance({bulletin:parseBulletin(doc,now)},dept,now);

test('official archive: coastal colors, exact transition and geographic scope', () => {
  for (const [dept,hour,levels] of [['40','18:59:59',[]],['40','19:00:00',['yellow']],['29','12:00:00',[]],['06','12:00:00',['yellow']]]) {
    const result = select(fixture,dept,at(hour));
    assert.equal(result.status,'available');
    assert.deepEqual(result.alerts.map(v=>v.level),levels);
    assert.equal(result.issuedAt,'2026-11-18T05:00:22.000Z');
    assert.ok(schemaValidator('Alerts')(result));
  }
  assert.equal(select(fixture,'75',at('17:00')).status,'unknown');
  const cached={bulletin:parseBulletin(fixture,at('22:58'))};
  assert.equal(currentVigilance(cached,'40',at('23:00')).status,'unknown');
  assert.equal(currentVigilance({bulletin:parseBulletin(fixture,at('12:00'))},'06',at('12:10')).reason,'expired');
  const malformed=structuredClone(fixture), slots=malformed.product.periods[0].timelaps.domain_ids[0].phenomenon_items[0].timelaps_items;
  slots.push({...slots[0],color_id:4});
  assert.equal(select(malformed,'06',at('12:00')).status,'unknown','ambiguous timeline');
  slots.pop();slots[0].color_id=0;
  assert.equal(select(malformed,'06',at('12:00')).status,'unknown','invalid color');
  assert.throws(()=>parseBulletin(fixture,at('04:59')));
  assert.throws(()=>parseBulletin(fixture,Date.parse('2026-11-20')));
});

test('one authenticated request; missing key, provider failures and cooldown replace prior data safely', async () => {
  let saved,expires,calls=0,response,denied=false;
  const cache={ getJson:async()=>saved, setJson:async(k,value,ttl)=>{assert.equal(k,cacheKey);saved=value;expires=ttl;return !denied;} };
  const request=async(url,init)=>{
    calls++;assert.equal(url,'https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours');
    assert.equal(init.headers.apikey,'fixture-only');assert.equal(init.redirect,'error');assert.ok(init.signal);
    return response;
  };
  const collect=(key='fixture-only')=>collectVigilance(cache,key,request,at('12:00'));
  assert.equal(await collect(''),'disabled');assert.equal(calls,0);
  response=Response.json(fixture);assert.equal(await collect(),'available');assert.equal(expires,600);
  for (const [status,reason] of [[401,'unauthorized'],[403,'unauthorized'],[503,'unavailable'],[429,'rate_limited']]) {
    response=new Response(null,{status,headers:{'Retry-After':'900'}});assert.equal(await collect(),reason);
    assert.equal(currentVigilance(saved,'06',at('12:00')).status,'unknown');assert.ok(!JSON.stringify(saved).includes('fixture-only'));
  }
  const before=calls;assert.equal(expires,900);await collect();assert.equal(calls,before);
  saved=null;response=new Response('not JSON');assert.equal(await collect(),'unavailable');
  response=new Response('x',{headers:{'Content-Length':String(5*1024*1024)}});assert.equal(await collect(),'unavailable');
  denied=true;await assert.rejects(collect(''),/cache unavailable/);
});
