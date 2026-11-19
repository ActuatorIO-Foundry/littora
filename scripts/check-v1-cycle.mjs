import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { measureSite } from './check-v1-coverage.mjs';

const sql=readFileSync(new URL('./v1-forecast-cycle.sql',import.meta.url),'utf8');
const minute=60_000;
function read(since){
  const output=execFileSync('docker',['compose','-f','docker-compose.local.yml','exec','-T','postgres',
    'psql','-XqAt','-v','ON_ERROR_STOP=1','-v','since='+since,'-U','littora','-d','littora'],
    {input:'BEGIN READ ONLY;\n'+sql+'\nCOMMIT;',encoding:'utf8',timeout:20_000});
  return JSON.parse(output);
}

export async function waitForCoverage(ref,io,mode='watch') {
  const start=Date.parse(ref.start);
  if(!Number.isFinite(start)||!/^[a-f0-9]{32}$/.test(ref.scope))throw Error('Invalid cycle reference');
  if(!['watch','resume'].includes(mode))throw Error('Invalid observation mode');
  let previous=start, completedBy=null, observingSince=mode==='resume'?null:start;
  async function sample(){
    const state=await io.read(ref.start),at=Date.parse(state.at);
    if(!Number.isFinite(at)||at<previous)throw Error('Invalid database time');
    observingSince??=at;
    if(at-observingSince>=8*60*minute)throw Error('Cycle timed out; no final public verdict');
    previous=at;
    if(state.scope!==ref.scope)throw Error('Catalogue or forecast targets changed; restart the cycle');
    if(!Array.isArray(state.sources)||state.sources.length!==2 ||
       !['open-meteo','open-meteo-marine'].every(s=>state.sources.some(r=>r.source===s)) ||
       state.sources.some(r=>!Number.isSafeInteger(r.targets)||r.targets<1||!Number.isSafeInteger(r.finished)||r.finished<0||r.finished>r.targets)){
      throw Error('Incomplete target inventory');
    }
    return state;
  }
  while(true){
    const state=await sample(),finished=state.sources.every(r=>r.finished===r.targets);
    if(finished && !completedBy)completedBy=state.at;
    if(!finished && completedBy)throw Error('Cycle evidence lost');
    if(completedBy && previous-Date.parse(completedBy)>=15*minute){
      const publicCoverage=await io.measure();
      const after=await sample();
      if(!after.sources.every(r=>r.finished===r.targets))throw Error('Cycle evidence lost during measurement');
      if(!state.catalogueIds || state.catalogueIds!==publicCoverage.catalogueIds ||
         !Number.isFinite(Date.parse(publicCoverage.asOf)) || Date.parse(publicCoverage.asOf)<Date.parse(state.at)-1000 ||
         Date.parse(publicCoverage.asOf)>Date.parse(after.at)+1000)throw Error('Public snapshot differs from the observed local cycle');
      return {status:'measured',start:ref.start,completedBy,scope:ref.scope,zones:after.sources,public:publicCoverage};
    }
    io.progress?.(state,completedBy);
    await io.sleep(minute*5);
  }
}

if(import.meta.main){
  try{
    const [mode='start',start,scope,site,...extra]=process.argv.slice(2);
    if(mode==='start'&&!start){
      const state=read('infinity');
      console.log(JSON.stringify({start:state.at,scope:state.scope,sources:state.sources},null,2));
    }else if(['watch','resume'].includes(mode)&&start&&scope&&!extra.length){
      const local=new URL(site??'http://127.0.0.1:4200');
      if(!['127.0.0.1','localhost','[::1]'].includes(local.hostname) || !['http:','https:'].includes(local.protocol) ||
        local.username || local.password) throw Error('Use a local site URL');
      const result=await waitForCoverage({start,scope},{read,measure:()=>measureSite(local),sleep,
        progress:(state,completedBy)=>console.log(state.at,state.sources.map(s=>s.source+' '+s.finished+'/'+s.targets).join(', '),
          completedBy?'waiting for search refresh':'collecting')},mode);
      console.log(JSON.stringify(result,null,2));
      if(!result.public.coverageMet) process.exitCode=2;
    }else throw Error('Use start, watch or resume START SCOPE [LOCAL_SITE]');
  }catch(e){console.error('Cycle not validated:',e.message);process.exitCode=1;}
}
