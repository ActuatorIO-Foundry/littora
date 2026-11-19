type Flag = 'green' | 'yellow' | 'red';
type Observation = {
  id: string; value: Record<string,unknown>; status: string; created_at: string | Date;
  observed_at?: string | Date; expires_at?: string | Date;
  contributor_id?: string; network_hash?: string;
};
const flags: Record<string,Flag> = {green:'green',vert:'green',verte:'green',yellow:'yellow',jaune:'yellow',orange:'yellow',red:'red',rouge:'red'};

export function flagConsensus(rows: Observation[], now = Date.now()) {
  const valid = rows.flatMap(row => {
    const raw=String(row.value?.flag ?? row.value?.drapeau ?? row.value?.value);
    const flag=Object.prototype.hasOwnProperty.call(flags,raw)?flags[raw]:undefined;
    const time=new Date(row.observed_at ?? row.created_at).getTime(),created=new Date(row.created_at).getTime();
    const expires=row.expires_at?new Date(row.expires_at).getTime():created+24*3600_000;
    if(row.status!=='verified'||row.value?.demo===true||row.value?.demo==='true'||!flag||
      !Number.isFinite(time)||time>now||time<=now-12*3600_000||!(created<=now)||!(expires>now))return [];
    return [{row,flag,time}];
  })
    .sort((a,b)=>b.time-a.time||({red:3,yellow:2,green:1}[b.flag]-{red:3,yellow:2,green:1}[a.flag])||a.row.id.localeCompare(b.row.id));
  if(!valid.length)return null;
  const counts: Record<Flag,number>={green:0,yellow:0,red:0};
  const actors=new Set<string>(),networks=new Set<string>();
  const capped=rows.length>1000;
  if(!capped)for(const item of valid){
    const {contributor_id:actor,network_hash:network}=item.row;
    if(item.time<=now-3*3600_000||!actor||!network||actors.has(actor)||networks.has(network))continue;
    actors.add(actor);networks.add(network);counts[item.flag]++;
  }
  const participants=counts.green+counts.yellow+counts.red;
  const ranked=(Object.keys(counts) as Flag[]).sort((a,b)=>counts[b]-counts[a]);
  const agreement=participants>=3?counts[ranked[0]]/participants:null;
  const consensus=!capped&&agreement!==null&&agreement>=2/3&&counts[ranked[0]]>counts[ranked[1]];
  const recentRed=valid.find(item=>item.flag==='red');
  const selected=valid.slice(0,12);
  if(recentRed&&!selected.includes(recentRed))selected.push(recentRed);
  return {flag:consensus?ranked[0]:null,confidence:consensus?Number(agreement!.toFixed(2)):0,
    agreement:agreement===null?null:Number(agreement.toFixed(2)),participants,counts,
    status:capped?'capped':participants<3?'insufficient':consensus?'consensus':'conflicting',
    windowHours:3,historyHours:12,
    recentRedAt:recentRed?new Date(recentRed.time).toISOString():null,
    history:selected.map(item=>({reportId:item.row.id,flag:item.flag,time:new Date(item.time).toISOString(),confidence:0})),
  };
}
