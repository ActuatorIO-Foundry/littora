const {Pool}=require('pg');
const {readFile}=require('node:fs/promises');
const {join}=require('node:path');
const {assertCurrent}=require('./database.cjs');
const {importArs}=require('../dist/modules/water-quality/ars-import');
const {recordDecision}=require('../dist/modules/water-quality/official-decisions');

async function main([command,...args]){
  if(!process.env.DATABASE_URL)throw Error('Set DATABASE_URL explicitly');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
  try {
    await assertCurrent(pool);
    if(command==='import' && args.length<=1)return await importArs(pool,args[0]?p=>readFile(join(args[0],p+'.csv')):undefined);
    if(command==='status'&&!args.length)return (await pool.query('select id,imported_at,stats,sources from ars_releases order by sequence desc')).rows;
    if(command==='review'&&args.length===1&&/^[0-9A-B]{5}$/.test(args[0]))return (await pool.query(
      'select release,code,name,status,beach_id,candidates from ars_sites where insee=$1 order by release,code',[args[0]])).rows;
    if(command==='rejects'&&args.length===1)return (await pool.query('select rejected from ars_releases where id=$1',[args[0]])).rows;
    if(command==='decision'&&args.length===5){
      const [action,beachId,reference,day,source]=args;await recordDecision(pool,{action,beachId,reference,day,source});return {recorded:true};
    }
    throw Error('Use import [DIRECTORY], status, review INSEE, rejects RELEASE or decision close|lift BEACH_UUID CASE_REF YYYY-MM-DD OFFICIAL_URL');
  }finally{await pool.end();}
}
main(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(e=>{console.error(e.message);process.exitCode=1;});
