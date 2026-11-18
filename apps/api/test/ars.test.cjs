const assert = require('node:assert/strict');
const {test} = require('node:test');
const {decodeResource, officialDate, measurement} = require('../dist/modules/water-quality/ars-source');
const {matchSites} = require('../dist/modules/water-quality/ars-match');
const site={code:'FRL0583009M083026',city:'Bandol',name:'Plage de Capelan',lat:43.1355,lon:5.7382,water:'sea'};
const beach={id:'a',name:'Plage du Capélan',city:'Bandol',lat:43.1356,lon:5.7383,water_type:'sea'};

test('ARS: verified bytes only; missing and detection-limit results never become measured zero',()=>{
  assert.throws(()=>decodeResource('samples',Buffer.from('partial')),/checksum/);
  assert.equal(officialDate('29/02/2025'),null);
  assert.equal(officialDate('29/02/2024'),'2024-02-29');
  assert.deepEqual(measurement('0','Valeur manquante'),{value:null,qualifier:'missing'});
  assert.deepEqual(measurement('0','Valeur confirmée'),{value:0,qualifier:'confirmed'});
  assert.deepEqual(measurement('15','Limite de détection'),{value:15,qualifier:'detection-limit'});
  assert.throws(()=>measurement('-1','Valeur confirmée'));
});

test('ARS: site linkage requires geography, identity, commune and reciprocal uniqueness',()=>{
  const match=(sites,beaches)=>matchSites(sites,beaches).map(r=>r.status);
  assert.deepEqual(match([site],[beach]),['matched']);
  for(const changed of [{city:'Other'},{lat:42},{water_type:'river'},{name:'Different'}])
    assert.ok(!match([site],[{...beach,...changed}]).includes('matched'));
  assert.deepEqual(match([site],[beach,{...beach,id:'b'}]),['review']);
  assert.deepEqual(match([site,{...site,code:'other'}],[beach]),['review','review']);
});

test('ARS: conflicting source keys quarantined; pollution, annual class and closure stay separate',()=>{
  const {prepareArchive}=require('../dist/modules/water-quality/ars-archive');
  const prefix=['2025','PACA','083','FRL0583009M083026'];
  const sample=[...prefix,'15/07/2025','0','15','Valeur manquante','Limite de détection','Prélèvement manquant',''];
  const data={sites:[[...prefix,'','','Capélan','83009','Bandol','','Eau côtière','5,738','43,135']],
    samples:[sample,[...sample.slice(0,6),'99',...sample.slice(7)]],classes:[[...prefix,'','1','','','']],
    events:[[...prefix,'Pollution à court terme','14/07/2025','15/07/2025','',''],[...prefix,'Interdiction sanitaire','15/07/2025','18/07/2025','','']]};
  const a=prepareArchive(data);
  assert.deepEqual(a.observations.map(r=>r.product),['class','pollution','closure']);
  assert.ok(a.rejected.some(r=>r.reason==='conflicting-source-key'));
});
