require('reflect-metadata');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID,randomBytes,X509Certificate} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {mkdtempSync,readFileSync,writeFileSync,rmSync} = require('node:fs');
const {resolve,join} = require('node:path');
const {tmpdir} = require('node:os');
const https = require('node:https');
const {Pool} = require('pg');
const {Test} = require('@nestjs/testing');
const {ContactModule} = require('../../dist/modules/contact/contact.module');
const {ContactStore} = require('../../dist/modules/contact/contact-store.service');
const {verifyContactRole} = require('../../dist/modules/contact/contact-store');
const {managementServer} = require('../../dist/contact-management');
const {configureHttpBoundary} = require('../../dist/http/http-boundary');

function testCertificates(dir) {
  const ssl = (...args)=>execFileSync('openssl',args,{cwd:dir,stdio:'ignore'});
  const read = file=>readFileSync(join(dir,file));
  ssl('req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=Inbox Test CA','-out','ca.pem','-keyout','ca.key');
  function leaf(name,usage) {
    ssl('req','-new','-newkey','rsa:2048','-nodes','-subj','/CN='+name,'-out',name+'.csr','-keyout',name+'.key');
    writeFileSync(join(dir,'leaf.ext'),'basicConstraints=CA:FALSE\nsubjectAltName=DNS:localhost\nextendedKeyUsage='+usage+'\n');
    ssl('x509','-req','-in',name+'.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-days','1','-extfile','leaf.ext','-out',name+'.pem');
    return {cert:read(name+'.pem'),key:read(name+'.key')};
  }
  return {ca:read('ca.pem'),server:leaf('localhost','serverAuth'),manager:leaf('manager','clientAuth'),member:leaf('member','clientAuth')};
}

test('public contact to private manager inbox, independent of catalogue and member sessions',{timeout:45000},async t=>{
  const url=new URL(process.env.TEST_DATABASE_URL);
  assert.equal(url.pathname,'/littora_ci_test');
  const suffix=randomUUID().replaceAll('-',''), name='littora_contact_ci_'+suffix;
  const admin=new Pool({connectionString:url.href,max:1}), roles=[], pools=[];
  const saved={...process.env}, keys=['CONTACT_QUOTA_KEY','CONTACT_SUBMIT_DATABASE_URL','REPORT_PROXY_IPV4'];
  const dir=mkdtempSync(join(tmpdir(),'inbox-test-'));
  let api,server;
  await admin.query('create database '+name+' template template0');
  url.pathname='/'+name;
  const owner=new Pool({connectionString:url.href,max:1});
  t.after(async()=>{
    if(server?.listening) await new Promise(ok=>server.close(ok));
    await api?.close();
    for(const p of [...pools,owner]) await p.end();
    try {
      await admin.query('drop database '+name);
      for(const r of roles.reverse()) await admin.query('drop role '+r);
    } finally {
      await admin.end(); rmSync(dir,{recursive:true,force:true});
      for(const k of keys) {if(saved[k]===undefined) delete process.env[k]; else process.env[k]=saved[k];}
    }
  });
  const ddl=readFileSync(resolve(__dirname,'../../../../infra/contact/0001_inbox.sql'),'utf8');
  await assert.rejects(admin.query(ddl),/dedicated contact/); await admin.query('rollback');
  await owner.query(ddl); roles.push('littora_contact_owner','littora_contact_submit','littora_contact_manage');
  async function login(label,group) {
    const user=label+suffix, pass=randomBytes(24).toString('hex');
    await admin.query('create role '+user+" login password '"+pass+"'"); roles.push(user);
    if(group) await admin.query('grant '+group+' to '+user);
    const target=new URL(url); target.username=user; target.password=pass;
    const pool=new Pool({connectionString:target.href,max:2}); pools.push(pool);
    return {dsn:target.href,pool};
  }
  const sender=await login('submit','littora_contact_submit'),manager=await login('manager','littora_contact_manage'),other=await login('member');
  await assert.rejects(other.pool.query('select 1'),/permission denied/);
  for(const pool of [manager.pool,sender.pool]) await assert.rejects(pool.query('select * from inbox.message'),/permission denied/);
  await assert.rejects(sender.pool.query('select * from inbox.open_mail()'),/permission denied/);
  await assert.rejects(verifyContactRole(manager.pool,false)); await assert.rejects(verifyContactRole(owner,true));
  process.env.CONTACT_SUBMIT_DATABASE_URL=sender.dsn; process.env.CONTACT_QUOTA_KEY=randomBytes(32).toString('hex'); delete process.env.REPORT_PROXY_IPV4;
  api=(await Test.createTestingModule({imports:[ContactModule]}).compile()).createNestApplication({logger:false});
  api.setGlobalPrefix('api'); configureHttpBoundary(api); await api.listen(0,'127.0.0.1');
  const publicUrl=await api.getUrl()+'/api/contact';
  const data={topic:'correction',email:'test@example.org',message:'Correction de recette.'};
  const submit=(body=data)=>fetch(publicUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const available=async()=>(await (await fetch(publicUrl+'/availability')).json()).available;
  assert.equal(await available(),false);
  const offline=await submit(); assert.equal(offline.status,503); assert.equal(offline.headers.get('cache-control'),'no-store');

  const tls=testCertificates(dir), origin='https://localhost:9443';
  const fp=new X509Certificate(tls.manager.cert).fingerprint256.replaceAll(':','');
  server=managementServer(manager.pool,{ca:tls.ca,...tls.server},new Set([fp]),origin);
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const root='/gestion/contact';
  function visit(identity,path=root,method='GET',headers={}) {
    return new Promise((ok,fail)=>{
      const req=https.request({host:'127.0.0.1',port:server.address().port,servername:'localhost',agent:false,ca:tls.ca,
        ...identity,path,method,headers:{host:new URL(origin).host,...headers}},res=>{
        let body=''; res.setEncoding('utf8');res.on('data',s=>body+=s);res.on('end',()=>ok({status:res.statusCode,headers:res.headers,body}));
      });req.on('error',fail);req.end();
    });
  }
  await assert.rejects(visit({})); assert.equal((await visit(tls.member)).status,403);
  assert.equal(await available(),false);
  assert.equal((await visit(tls.manager)).status,200); assert.equal(await available(),true);
  for(const body of [{...data,email:'bad'},{...data,message:' '},{...data,topic:'other'},{...data,message:'x'.repeat(5001)},{...data,name:'unused'}]) {
    assert.equal((await submit(body)).status,400);
  }
  const res=await submit(); assert.equal(res.status,201); const {reference}=await res.json();
  assert.match(reference,/^[a-f0-9-]{36}$/); assert.equal((await fetch(publicUrl+'/'+reference)).status,404);
  assert.ok((await visit(tls.manager)).body.includes(reference));
  const path=root+'/'+reference, detail=await visit(tls.manager,path);
  assert.equal(detail.status,200); assert.match(detail.headers['cache-control'],/no-store/); assert.ok(detail.body.includes(data.message));
  assert.equal((await visit(tls.member,path)).status,403);
  const attempts=await Promise.all(Array.from({length:6},()=>submit()));
  assert.equal(attempts.filter(x=>x.status===201).length,4); assert.equal(attempts.filter(x=>x.status===429).length,2);
  await owner.query("update inbox.quota set hits=120 where bucket='global'");
  await assert.rejects(sender.pool.query('select inbox.submit($1,$2,$3,$4)',[data.email,data.topic,data.message,'a'.repeat(64)]),{code:'P0429'});
  assert.equal((await visit(tls.manager,path+'/traiter','POST')).status,403);
  assert.equal((await visit(tls.manager,path+'/traiter','POST',{origin})).status,303);
  assert.equal((await visit(tls.manager,path)).status,404);
  await owner.query("update inbox.message set received_at=now()-interval '31 days'");
  await owner.query("update inbox.watch set last_opened=now()-interval '73 hours'");
  assert.equal(await available(),false); assert.equal((await submit()).status,503);
  await api.get(ContactStore).purge();
  assert.equal((await owner.query('select count(*)::int as n from inbox.message')).rows[0].n,0);
});
