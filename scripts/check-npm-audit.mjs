import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function checkNpmAudit(report,lock,exceptions,now=new Date().toISOString().slice(0,10)) {
  if(report?.auditReportVersion!==2 || report.error || !report.vulnerabilities || Array.isArray(report.vulnerabilities) ||
    !Number.isInteger(report.metadata?.vulnerabilities?.total) ||
    report.metadata.vulnerabilities.total!==Object.keys(report.vulnerabilities).length || !lock?.packages) {
    throw new Error('Incomplete audit or lockfile');
  }
  if(!Array.isArray(exceptions)||exceptions.some(e=>e.scope!=='development-only'||!/^GHSA-[a-z0-9-]+$/.test(e.id)||
    !Array.isArray(e.versions)||!e.versions.length||!/^\d{4}-\d{2}-\d{2}$/.test(e.expires)))throw new Error('Invalid security exception');
  const findings=report.vulnerabilities;
  const memo=new Map();
  const acceptedIds=new Set();
  function allowed(name,ancestors=new Set()) {
    if(memo.has(name))return memo.get(name);
    if(ancestors.has(name))return false;
    const item=findings[name];
    if(!item||!Array.isArray(item.nodes)||!item.nodes.length||!Array.isArray(item.via)||!item.via.length||
      !item.nodes.every(path=>lock.packages[path]?.dev===true))return false;
    const next=new Set([...ancestors,name]);
    const ok=item.via.every(via=>{
      if(typeof via==='string')return allowed(via,next);
      const exception=exceptions.find(e=>via.url===`https://github.com/advisories/${e.id}`&&via.dependency===e.package&&name===e.package);
      if(!exception||exception.expires<=now||item.fixAvailable===true||
        (item.fixAvailable?.name===name&&!exception.versions.includes(item.fixAvailable.version))||
        !item.nodes.every(path=>exception.versions.includes(lock.packages[path].version)))return false;
      acceptedIds.add(exception.id);return true;
    });
    memo.set(name,ok);return ok;
  }
  const blocked=Object.keys(findings).filter(name=>!allowed(name));
  return {blocked,accepted:exceptions.filter(e=>acceptedIds.has(e.id)).map(e=>({id:e.id,expires:e.expires,issue:e.issue})),
    affectedPackages:Object.keys(findings).length};
}

function main(){
  const result=spawnSync('npm',['audit','--json'],{encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});
  if(result.error||![0,1].includes(result.status))throw new Error('Security audit unavailable; refusing success');
  const report=JSON.parse(result.stdout);
  const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
  const exceptions=JSON.parse(readFileSync(new URL('../infra/npm-security-exceptions.json',import.meta.url),'utf8'));
  const outcome=checkNpmAudit(report,lock,exceptions);
  for(const exception of outcome.accepted)console.warn(`Known development-only advisory ${exception.id}; exception expires ${exception.expires}; ${exception.issue}`);
  if(outcome.blocked.length){
    console.error('Unaccepted vulnerable dependencies: '+outcome.blocked.join(', '));process.exitCode=1;
  }else if(outcome.affectedPackages){
    console.log(`Audit policy passed with ${outcome.affectedPackages} affected development dependencies. This is not a vulnerability-free audit; public deployment remains blocked.`);
  }else console.log('Audit passed: no reported vulnerabilities.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){console.error(error.message==='Incomplete audit or lockfile'?error.message:'Security audit failed; no success assumed.');process.exitCode=1;}
}
