// Aggregate diagnostics only. Reading history never refreshes a forecast or an index.
const {Pool}=require('pg');
const Redis=require('ioredis');
const {measure,history}=require('../dist/jobs/score-coverage');
async function main(){
  const [mode='sample',count,...rest]=process.argv.slice(2);
  if(!['sample','history'].includes(mode)||rest.length||(mode==='sample' && count!==undefined))
    throw Error('Use: score-coverage.cjs sample | history [number of quarter-hours]');
  if(!process.env.REDIS_URL || (mode==='sample'&&!process.env.DATABASE_URL)) throw Error('Missing configuration');
  const redis=new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:1,commandTimeout:4000,connectTimeout:4000});
  redis.on('error',()=>{});
  const db=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
  try {
    const report=mode==='sample'?await measure(db,redis):await history(redis,count===undefined?undefined:Number(count));
    console.log(JSON.stringify(report,null,2));
  }finally{redis.disconnect();await db.end();}
}
main().catch(()=>{console.error('Score coverage unavailable: check command, database and cache.');process.exitCode=1;});
