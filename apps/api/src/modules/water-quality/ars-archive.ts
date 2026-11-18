import { officialDate, measurement, season, Product } from './ars-source';
import { Site } from './ars-match';
type Row = {code:string;product:string;identity:string;observed:string|null;ended:string|null;data:Record<string,unknown>};
export function prepareArchive(input:Record<Product,string[][]>) {
  const sites=new Map<string,Site>(), excluded=new Set<string>(), rows=new Map<string,Row>(), conflicts=new Set<string>();
  const firstSeen=new Map<string,number>();
  const rejected:Array<{product:string;line:number;code:string;reason:string}>=[];
  const reject=(product:string,i:number,code:string,reason:string)=>rejected.push({product,line:i+2,code,reason});
  for(const [i,r] of input.sites.entries()) {
    const code=r[3], insee=r[7], lat=Number(r[12].replace(',','.')),lon=Number(r[11].replace(',','.'));
    if(sites.has(code)||excluded.has(code))throw Error('Duplicate site in official release');
    if(!/^(?:[0-8]\d|9[0-5]|2[AB])\d{3}$/.test(insee)){excluded.add(code);reject('sites',i,code,'outside-metropolitan-scope');continue;}
    if(r[0]!==String(season)||!/^FR[A-Z0-9]{10,20}$/.test(code)||!r[6].trim()||!r[8].trim()||!r[11].trim()||!r[12].trim()||
       !(lat>=41&&lat<=52&&lon>=-6&&lon<=10)){reject('sites',i,code,'invalid-site');continue;}
    const types:Record<string,string>={'Eau côtière':'sea','Lac':'lake','Rivière':'river'};
    sites.set(code,{code,insee,city:r[8].trim(),name:r[6].trim(),lat,lon,water:types[r[10]]??'unknown'});
  }
  for(const p of ['samples','classes','events'] as const)for(const [i,r] of input[p].entries()) {
    const code=r[3];
    if(!sites.has(code)){reject(p,i,code,excluded.has(code)?'outside-metropolitan-scope':'unknown-site');continue;}
    try {
      if(r[0]!==String(season))throw Error('wrong-season');
      let row:Row;
      if(p==='samples'){
        const date=officialDate(r[4]);if(!date)throw Error('invalid-date');
        row={code,product:'sample',identity:date,observed:date,ended:null,data:{
          enterococci:measurement(r[5],r[7]),ecoli:measurement(r[6],r[8]),sampleStatus:r[9]||null}};
      } else if(p==='classes'){
        if(!/^[0-4]$/.test(r[5]))throw Error('unknown-class');
        row={code,product:'class',identity:String(season),observed:null,ended:null,data:{classificationCode:r[5]}};
      } else {
        if(r[4]==='Saison balnéaire')continue;
        const date=officialDate(r[5]),end=r[6].trim()?officialDate(r[6]):null;
        if(!date||(r[6].trim()&&!end)||(end&&end<date))throw Error('invalid-period');
        const kind=r[4],product=['Interdiction sanitaire','Interdiction non sanitaire'].includes(kind)?'closure':
          kind==='Pollution à court terme'?'pollution':'event';
        row={code,product,identity:[kind,date,end].join(':'),observed:date,ended:end,data:{kind}};
      }
      const key=JSON.stringify([code,row.product,row.identity]);
      if(conflicts.has(key)){reject(p,i,code,'conflicting-source-key');continue;}
      if(rows.has(key)){
        if(JSON.stringify(rows.get(key))!==JSON.stringify(row)){rows.delete(key);conflicts.add(key);reject(p,firstSeen.get(key)!,code,'conflicting-source-key');reject(p,i,code,'conflicting-source-key');}
        else reject(p,i,code,'duplicate-row');
      }else {rows.set(key,row);firstSeen.set(key,i);}
    }catch(e){reject(p,i,code,(e as Error).message);}
  }
  return {sites:[...sites.values()],observations:[...rows.values()],rejected};
}
