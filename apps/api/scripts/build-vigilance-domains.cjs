// Rebuild offline from the two pinned public source files documented in METEOFRANCE.md.
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { resolve } = require('node:path');
function features(file,sha) {
  const bytes=readFileSync(file);
  if (createHash('sha256').update(bytes).digest('hex')!==sha) throw new Error('Unexpected source revision');
  return JSON.parse(bytes).features;
}
const sea=features(process.argv[2],'c120ef8a89a4be5f8249a5c45481eb2f1552448210ec83e5a9b04995dd5f0c5a');
const land=features(process.argv[3],'10f5c6ffc2dc857b4f4fc360297f97f6f01fc3ba3eb3a326ee92b76baefed447');
const codes=new Set(sea.map(f=>f.properties.code));
const areas=[];
for (const [code,g] of [...sea.map(f=>[f.properties.code,f.geometry]),
    ...land.filter(f=>codes.has(f.properties.code+'10')).map(f=>[f.properties.code+'10',f.geometry])]) {
  for (const rings of g.type==='Polygon'?[g.coordinates]:g.coordinates) {
    const xs=rings[0].map(p=>p[0]), ys=rings[0].map(p=>p[1]);
    areas.push({code,bbox:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)],
      geometry:{type:'Polygon',coordinates:rings}});
  }
}
writeFileSync(resolve(__dirname,'../src/modules/alerts/coastal-domains.json'),
  '[\n'+areas.map(a=>'  '+JSON.stringify(a)).join(',\n')+'\n]\n');
