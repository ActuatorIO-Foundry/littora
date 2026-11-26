require('reflect-metadata');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {X509Certificate,randomBytes,randomUUID}=require('node:crypto');
const {mkdtempSync,readFileSync,rmSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const net=require('node:net');
const {Pool}=require('pg');
const {testCertificates}=require('../helpers/staff-certificates.cjs');
const {StaffAccess,verifyStaffRole,staffCookie}=require('../../dist/staff/staff-access');
const {ModerationConsole}=require('../../dist/staff/moderation-console');
const {managementServer}=require('../../dist/contact-management');
const {migrate,seed}=require('../../scripts/database.cjs');

test('individual staff rights, supervised enrollment, distinct roles and recovery',{timeout:120000},async t=>{
  const target=new URL(process.env.TEST_DATABASE_URL); assert.equal(target.pathname,'/littora_ci_test');
  const admin=new Pool({connectionString:target.href,max:1}), dbs=[], roles=[], pools=[];
  const dir=mkdtempSync(join(tmpdir(),'littora-staff-test-')), suffix=randomUUID().replaceAll('-','');
  let server,browser,consoleApp;
  t.after(async()=>{
    await browser?.close();
    if(server?.listening)await new Promise(ok=>server.close(ok));
    await consoleApp?.close();
    for(const p of pools)await p.end();
    try{
      for(const n of dbs)await admin.query('drop database '+n);
      for(const n of roles.reverse())await admin.query('drop role '+n);
    }finally{await admin.end();rmSync(dir,{recursive:true,force:true});}
  });
  async function db(prefix){
    const name=prefix+suffix,u=new URL(target);u.pathname='/'+name;
    await admin.query('create database '+name+' template template0');dbs.push(name);
    const pool=new Pool({connectionString:u.href,max:2});pools.push(pool);return {u,pool};
  }
  async function login(u,name,group){
    const pass=randomBytes(32).toString('hex');
    await admin.query('create role '+name+" login password '"+pass+"'");roles.push(name);
    if(group)await admin.query('grant '+group+' to '+name);
    const dsn=new URL(u);dsn.username=name;dsn.password=pass;
    const pool=new Pool({connectionString:dsn.href,max:1});pools.push(pool);return {pool,dsn:dsn.href};
  }
  const staff=await db('littora_staff_ci_');
  const ddl=readFileSync(resolve(__dirname,'../../../../infra/staff/0001_webauthn.sql'),'utf8');
  await assert.rejects(admin.query(ddl),/dedicated staff/);await admin.query('rollback');
  await staff.pool.query(ddl);roles.push('littora_staff_owner','littora_staff_runtime');
  const runtime=await login(staff.u,'staff_runtime_'+suffix,'littora_staff_runtime');
  await verifyStaffRole(runtime.pool);await assert.rejects(verifyStaffRole(staff.pool));
  await assert.rejects(runtime.pool.query("insert into staff.account(certificate,capability) values(repeat('A',64),'contact')"),{code:'42501'});
  const tls=testCertificates(dir,true), fp=cert=>new X509Certificate(cert).fingerprint256.replaceAll(':','');
  const provision=async(cert,capability)=>(await staff.pool.query('insert into staff.account(certificate,capability) values($1,$2) returning id',
    [fp(cert),capability])).rows[0].id;
  const manager=await provision(tls.manager.cert,'contact'), moderator=await provision(tls.member.cert,'moderation');
  const active=id=>staff.pool.query("update staff.account set state='active' where id=$1",[id]);
  await assert.rejects(active(manager),/Two enrolled keys/);
  await assert.rejects(runtime.pool.query("update staff.account set state='active' where id=$1",[manager]),{code:'42501'});
  if(process.env.TEST_STAFF_BROWSER!=='1')return;
  const contact=await db('littora_contact_ci_');
  await contact.pool.query(readFileSync(resolve(__dirname,'../../../../infra/contact/0001_inbox.sql'),'utf8'));
  roles.push('littora_contact_owner','littora_contact_submit','littora_contact_manage');
  const reader=await login(contact.u,'inbox_'+suffix,'littora_contact_manage');
  const catalogue=await db('littora_ci_');await migrate(catalogue.pool);await seed(catalogue.pool);
  const modLogin='staff_'+moderator.replaceAll('-',''),modDb=await login(catalogue.u,modLogin);
  await catalogue.pool.query('grant usage on schema moderation to '+modLogin+';grant select on moderation.queue to '+modLogin+
    ';grant execute on function moderation.decide(uuid,text,text) to '+modLogin);
  const audit=readFileSync(resolve(__dirname,'../../../../infra/staff/check-moderation-logins.sql'),'utf8');
  const check=async allowed=>{
    const c=await catalogue.pool.connect();
    try{await c.query('begin read only');await c.query("select set_config('littora.approved_logins',$1,true)",[JSON.stringify(allowed)]);await c.query(audit);}
    finally{await c.query('rollback');c.release();}
  };
  await assert.rejects(check([target.username]),/Unapproved moderation login/);
  await check([target.username,modLogin]);
  await assert.rejects(modDb.pool.query('select * from reports'),{code:'42501'});
  const report=(await catalogue.pool.query("insert into reports(beach_id,type,value,status) select id,'jellyfish','{}','pending' from beaches limit 1 returning id")).rows[0].id;
  await catalogue.pool.query("insert into report_contributions(report_id,observed_at,expires_at) values($1,now(),now()+interval '1 day')",[report]);
  const probe=net.createServer();await new Promise(ok=>probe.listen(0,'127.0.0.1',ok));const port=probe.address().port;await new Promise(ok=>probe.close(ok));
  const origin='https://localhost:'+port, loginPage='/gestion/connexion', inbox='/gestion/contact', queue='/gestion/moderation';
  let at=Date.now();const gate=new StaffAccess(runtime.pool,origin,()=>at);
  consoleApp=new ModerationConsole({[moderator]:modDb.dsn});
  server=managementServer(reader.pool,{ca:tls.ca,...tls.server},gate,consoleApp);
  await new Promise(ok=>server.listen(port,'127.0.0.1',ok));
  const {chromium,expect}=require('@playwright/test');
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
  async function person(identity){
    const ctx=await browser.newContext({ignoreHTTPSErrors:true,clientCertificates:[{origin,...identity}]});
    const page=await ctx.newPage();const cdp=await ctx.newCDPSession(page);await cdp.send('WebAuthn.enable');
    const key=async()=>(await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'usb',hasUserVerification:true,
      isUserVerified:true,automaticPresenceSimulation:true}})).authenticatorId;
    const remove=authenticatorId=>cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId});
    async function press(){
      await page.goto(origin+loginPage);const done=page.waitForResponse(r=>r.url()===origin+loginPage+'/verifier',{timeout:10000});
      await page.getByRole('button',{name:'Utiliser ma clé de sécurité'}).click();return (await done).status();
    }
    return {ctx,page,key,remove,press,cdp};
  }
  const href=(p,path)=>p.page.goto(origin+path).then(r=>r.status());
  async function enroll(p,id){
    const one=await p.key();assert.equal(await p.press(),200);
    const [{credentialId}]= (await p.cdp.send('WebAuthn.getCredentials',{authenticatorId:one})).credentials;assert.ok(credentialId);
    await assert.rejects(active(id),/Two enrolled keys/);
    await p.remove(one);const two=await p.key();assert.equal(await p.press(),200);
    assert.equal((await p.ctx.cookies()).some(c=>c.name===staffCookie),false);
    await active(id);assert.equal(await p.press(),200);return two;
  }
  const m=await person(tls.manager);
  assert.equal(await href(m,inbox),401);
  const reserve=await enroll(m,manager);
  await expect(m.page.getByText('Aucune demande en attente.')).toBeVisible();
  assert.equal(await href(m,queue),403);
  const token=(await m.ctx.cookies()).find(c=>c.name===staffCookie);
  assert.ok(token.secure && token.httpOnly && token.sameSite==='Strict');
  at+=300001;assert.equal(await href(m,inbox),401);
  assert.equal(await m.press(),200);
  await staff.pool.query("update staff.account set state='revoked' where id=$1",[manager]);
  assert.equal(await href(m,inbox),403);await m.remove(reserve);
  const replacement=await person(tls.replacement);
  assert.equal(await href(replacement,inbox),403);
  const fresh=await provision(tls.replacement.cert,'contact');
  await enroll(replacement,fresh);await expect(replacement.page.getByText('Aucune demande en attente.')).toBeVisible();
  assert.equal(await href(m,inbox),403);
  await replacement.page.getByRole('button',{name:'Fermer la session'}).click();
  assert.equal(await href(replacement,inbox),401);
  const mod=await person(tls.member);assert.equal(await href(mod,inbox),403);
  await enroll(mod,moderator);
  await expect(mod.page.getByRole('button',{name:'Confirmer'})).toBeVisible();
  await mod.page.getByRole('button',{name:'Confirmer'}).click();
  await expect(mod.page.getByText('Aucun dossier en attente.')).toBeVisible();
  assert.deepEqual((await catalogue.pool.query('select operator_login,action from moderation.decisions where report_id=$1',[report])).rows,[{operator_login:modLogin,action:'publish'}]);
  await mod.page.getByText('Retirer une observation publiée').click();
  await mod.page.getByLabel('Référence de l’observation').fill(report);
  await mod.page.getByRole('button',{name:'Retirer la publication'}).click();
  await expect.poll(async()=>(await catalogue.pool.query('select status from reports where id=$1',[report])).rows[0].status).toBe('rejected');
  await staff.pool.query("update staff.account set capability='contact' where id=$1",[moderator]);
  assert.equal(await href(mod,queue),403);assert.equal(await href(mod,inbox),401);
  const history=(await staff.pool.query('select event from staff.audit order by id')).rows.map(r=>r.event);
  assert.ok(history.includes('revoked:contact')&&history.includes('active:moderation'));
});
