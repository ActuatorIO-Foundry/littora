import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {checkNpmAudit} from '../check-npm-audit.mjs';

const exception={id:'GHSA-fc5q-39xc-vjpf',package:'picomatch',versions:['2.3.2','4.0.4'],scope:'development-only',expires:'2026-11-24',issue:'https://example.test/45'};
function fixture(){
  const lock={packages:{'node_modules/picomatch':{version:'4.0.4',dev:true},'node_modules/builder':{version:'1.0.0',dev:true}}};
  const report={auditReportVersion:2,metadata:{vulnerabilities:{high:2,total:2}},vulnerabilities:{
    picomatch:{nodes:['node_modules/picomatch'],via:[{dependency:'picomatch',url:'https://github.com/advisories/GHSA-fc5q-39xc-vjpf'}],fixAvailable:false},
    builder:{nodes:['node_modules/builder'],via:['picomatch']},
  }};
  return {lock,report};
}
test('npm audit: only the reviewed advisory and development-only chains can be accepted',()=>{
  const {report,lock}=fixture();const result=checkNpmAudit(report,lock,[exception],'2026-11-17');
  assert.deepEqual(result.blocked,[]);assert.equal(result.accepted.length,1);assert.equal(result.affectedPackages,2);
  assert.equal(checkNpmAudit(report,lock,[],'2026-11-17').blocked.length,2);
  assert.equal(checkNpmAudit(report,lock,[exception],'2026-11-24').blocked.length,2);
});
test('npm audit: runtime, unexpected versions, new advisories and fixed releases remain blocking',()=>{
  for(const mutate of [
    ({lock})=>{lock.packages['node_modules/picomatch'].dev=false;},
    ({lock})=>{lock.packages['node_modules/builder'].dev=false;},
    ({lock})=>{lock.packages['node_modules/picomatch'].version='4.0.7';},
    ({report})=>{report.vulnerabilities.picomatch.via.push({dependency:'picomatch',url:'https://github.com/advisories/GHSA-another'});},
    ({report})=>{report.vulnerabilities.picomatch.fixAvailable=true;},
    ({report})=>{report.vulnerabilities.picomatch.fixAvailable={name:'picomatch',version:'4.0.8'};},
    ({report})=>{report.vulnerabilities.builder.via.push('missing');},
    ({lock})=>{delete lock.packages['node_modules/picomatch'];},
  ]){const input=fixture();mutate(input);assert.ok(checkNpmAudit(input.report,input.lock,[exception],'2026-11-17').blocked.length>0);}
});
test('npm audit: incomplete reports and cycles cannot become successful audits',()=>{
  const {report,lock}=fixture();
  assert.throws(()=>checkNpmAudit({},lock,[exception]),/Incomplete/);
  assert.throws(()=>checkNpmAudit({...report,error:{}},lock,[exception]),/Incomplete/);
  assert.throws(()=>checkNpmAudit({...report,vulnerabilities:{}},lock,[exception]),/Incomplete/);
  assert.throws(()=>checkNpmAudit(report,lock,[{...exception,scope:'all'}]),/Invalid/);
  report.vulnerabilities.picomatch.via=['builder'];
  assert.equal(checkNpmAudit(report,lock,[exception],'2026-11-17').blocked.length,2);
});
test('npm audit: installed picomatch occurrences are all development-only and pinned',()=>{
  const lock=JSON.parse(readFileSync(new URL('../../package-lock.json',import.meta.url),'utf8'));
  const entries=Object.entries(lock.packages).filter(([path])=>path.endsWith('/picomatch'));
  assert.ok(entries.length>0);
  for(const [,entry] of entries){assert.equal(entry.dev,true);assert.ok(exception.versions.includes(entry.version));}
});
