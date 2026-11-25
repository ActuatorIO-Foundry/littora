require('reflect-metadata');
const assert = require('node:assert/strict');
const {randomUUID, randomBytes, createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {test} = require('node:test');
const {Pool} = require('pg');
const {Test} = require('@nestjs/testing');
const {configureHttpBoundary} = require('../../dist/http/http-boundary');
const {MembersModule} = require('../../dist/modules/members/members.module');
const {establishMemberSession, memberCookie} = require('../../dist/modules/members/member-session');
const {GoogleLoginModule, secureLoginResponses, provider} = require('../../dist/member-login/google-login.module');
const {loginSettings, SessionIssuer} = require('../../dist/member-login/login-settings');
const {googleFixture} = require('../helpers/google-provider.cjs');

test('member sessions: two principals, private database permissions and real HTTP revocation', {timeout:30000}, async t => {
  const target = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(target.pathname, '/littora_ci_test');
  const admin = new Pool({connectionString:target.href, max:1});
  const suffix = randomUUID().replaceAll('-', '');
  const dbName = 'littora_members_ci_' + suffix;
  const roles = [], pools = [], apps = [];
  const env = [process.env.MEMBER_PUBLIC_ORIGIN, process.env.MEMBER_SESSION_DATABASE_URL];
  await admin.query('create database ' + dbName + ' template template0');
  target.pathname = '/' + dbName;
  const owner = new Pool({connectionString:target.href, max:1});
  t.after(async () => {
    for (const app of apps) await app.close();
    for (const p of pools) await p.end();
    await owner.end();
    try {
      await admin.query('drop database ' + dbName);
      for (const role of roles.reverse()) await admin.query('drop role ' + role);
    } finally {
      await admin.end();
      for (const [i,k] of ['MEMBER_PUBLIC_ORIGIN','MEMBER_SESSION_DATABASE_URL'].entries()) {
        if (env[i] === undefined) delete process.env[k]; else process.env[k] = env[i];
      }
    }
  });
  const ddl = readFileSync(resolve(__dirname,'../../../../infra/members/0001_sessions.sql'),'utf8');
  const catalogueAdmin=await admin.connect();
  try {
    await assert.rejects(catalogueAdmin.query(ddl), /dedicated member database/);
  } finally { await catalogueAdmin.query('rollback'); catalogueAdmin.release(); }
  await owner.query(ddl);
  roles.push('littora_members_owner','littora_session_reader','littora_session_issuer');
  async function login(prefix, grant) {
    const name = prefix + suffix, password = randomBytes(32).toString('hex');
    await admin.query(`create role ${name} login password '${password}'`);
    roles.push(name);
    if (grant) await admin.query(`grant ${grant} to ${name}`);
    const dsn = new URL(target); dsn.username = name; dsn.password = password;
    const pool = new Pool({connectionString:dsn.href,max:2});
    pools.push(pool);
    return {pool, dsn:dsn.href};
  }
  const reader = await login('read_', 'littora_session_reader');
  const issuer = await login('issue_', 'littora_session_issuer');
  const catalogue = await login('catalogue_', null);
  await assert.rejects(catalogue.pool.query('select 1'), {code:'42501'});
  await assert.rejects(reader.pool.query('select * from members.account'), {code:'42501'});
  await assert.rejects(reader.pool.query('select * from members.session'), {code:'42501'});
  await assert.rejects(establishMemberSession(reader.pool, {issuer:'https://id.example',subject:'A'}), {code:'42501'});
  await assert.rejects(issuer.pool.query("select * from members.read_session(null)"), {code:'42501'});

  const origin = 'https://littora.example';
  async function server(dsn) {
    if (dsn) process.env.MEMBER_SESSION_DATABASE_URL=dsn; else delete process.env.MEMBER_SESSION_DATABASE_URL;
    process.env.MEMBER_PUBLIC_ORIGIN=origin;
    const m = await Test.createTestingModule({imports:[MembersModule]}).compile();
    const app=m.createNestApplication({logger:false}); apps.push(app);
    app.setGlobalPrefix('api'); configureHttpBoundary(app);
    await app.listen(0,'127.0.0.1');
    return (await app.getUrl())+'/api/member/session';
  }
  for (const dsn of [undefined, target.href]) {
    const unavailable = await fetch(await server(dsn));
    assert.equal(unavailable.status,503);
    assert.match(unavailable.headers.get('cache-control'),/no-store/);
  }
  const url = await server(reader.dsn);
  const get = cookie => fetch(url, {headers: cookie ? {cookie} : {}});
  const end = (cookie, headers) => fetch(url,{method:'DELETE', headers:{cookie,...headers}});
  const idp = 'https://id.example';
  const start = async (sub, previous, iss=idp) => {
    const c = await establishMemberSession(issuer.pool,{issuer:iss, subject:sub},previous);
    assert.equal(c.name, memberCookie);
    assert.deepEqual({...c.options,expires:undefined},{path:'/',sameSite:'lax',secure:true,httpOnly:true,expires:undefined});
    assert.ok(Math.abs(c.options.expires.getTime()-Date.now()-12*3600000)<10000);
    return c.name+'='+c.value;
  };
  const a = await start('same-subject'), b = await start('same-subject',undefined,'https://other.example');
  const state = async cookie => {
    const response=await get(cookie);
    assert.equal(response.status,200); assert.match(response.headers.get('cache-control'),/no-store/);
    const data=await response.json(); assert.deepEqual(Object.keys(data).sort(),['expiresAt','memberId']);
    return data;
  };
  const alice=await state(a), bob=await state(b);
  assert.notEqual(alice.memberId,bob.memberId);
  assert.equal((await get()).status,401);
  assert.equal((await get(a+'; '+b)).status,401);
  assert.equal((await end(a+'; '+b,{origin})).status,400);
  await state(a); await state(b);
  assert.equal((await fetch(url+'?memberId='+bob.memberId,{headers:{cookie:a}})).status,400);
  const a2 = await start('same-subject',a);
  assert.notEqual(a,a2);
  assert.equal((await get(a)).status,401);
  assert.equal((await state(a2)).memberId,alice.memberId);
  for (const headers of [{},{origin:'https://other.example'},{origin,'sec-fetch-site':'cross-site'}]) {
    assert.equal((await end(a2,headers)).status,403);
  }
  await state(a2);
  // A storage error during logout must not clear the browser cookie or claim success.
  await owner.query('revoke execute on function members.end_session(bytea) from littora_session_reader');
  const unavailable=await end(a2,{origin});
  assert.equal(unavailable.status,503);
  assert.equal(unavailable.headers.get('set-cookie'),null);
  await owner.query('grant execute on function members.end_session(bytea) to littora_session_reader');
  await state(a2);
  const signedOut=await end(a2,{origin});
  assert.equal(signedOut.status,200);
  assert.deepEqual(await signedOut.json(),{signedOut:true});
  assert.match(signedOut.headers.get('set-cookie'),/^__Host-littora-member=;.*HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await get(a2)).status,401);
  await state(b);

  const hash=createHash('sha256').update(b.slice(memberCookie.length+1)).digest();
  assert.equal((await owner.query('select digest from members.session where account_id=$1',[bob.memberId])).rows[0].digest.equals(hash),true);
  await owner.query("update members.session set expires_at=now()-interval '1 second' where digest=$1",[hash]);
  assert.equal((await get(b)).status,401);
  const first=await start('multi-device');
  const devices=await Promise.all(Array.from({length:6},()=>start('multi-device')));
  assert.equal((await get(first)).status,401);
  assert.equal((await owner.query("select count(*)::int as n from members.session s join members.account a on a.id=s.account_id where a.subject='multi-device'")).rows[0].n,5);
  await owner.query("delete from members.account where subject='multi-device'");
  for (const device of devices) assert.equal((await get(device)).status,401);

  await t.test('isolated Google pilot: form, consent, session, cancellation and failure without a new account', async pilot => {
    const fixture = googleFixture();
    const settings = {origin, dsn:issuer.dsn, subject:'test-sub', clientId:fixture.clientId, secret:fixture.secret};
    for (const dsn of [reader.dsn, target.href]) {
      const wrong = new SessionIssuer({...settings,dsn});
      try { await assert.rejects(wrong.ready()); } finally { await wrong.onModuleDestroy(); }
    }
    const module = await Test.createTestingModule({imports:[GoogleLoginModule]})
      .overrideProvider(loginSettings).useValue(settings).overrideProvider(provider).useValue(fixture.config).compile();
    const app = module.createNestApplication({logger:false,bodyParser:false});
    apps.push(app); secureLoginResponses(app); await app.listen(0,'127.0.0.1');
    const local = await app.getUrl(), path = '/connexion/google';
    const form = await fetch(local + path);
    assert.match(await form.text(),/Continuer avec Google/);
    assert.equal(form.headers.has('set-cookie'),false);
    assert.equal((await fetch(local + path,{method:'POST',headers:{origin:'https://other.example'}})).status,403);
    const start = async () => {
      const resp = await fetch(local+path,{method:'POST',headers:{origin},redirect:'manual'});
      assert.equal(resp.status,303);
      const cookie=resp.headers.get('set-cookie');
      assert.match(cookie,/__Host-littora-login=.+Path=\/.*HttpOnly; Secure; SameSite=Lax/);
      return {location:resp.headers.get('location'),cookie:cookie.split(';')[0]};
    };
    const finish = (cb, cookie) => fetch(local + cb.pathname + cb.search, {headers:{cookie},redirect:'manual'});
    const outcome = (res, location) => {
      assert.equal(res.status,303); assert.equal(res.headers.get('location'),location);
      assert.match(res.headers.get('cache-control'),/no-store/); assert.equal(res.headers.get('referrer-policy'),'no-referrer');
    };
    const a = await start(), b = await start(), cb = fixture.authorise(a.location);
    outcome(await finish(cb,b.cookie),path+'/echec');
    const success = await finish(cb,a.cookie);
    outcome(success,'/');
    const session = success.headers.getSetCookie().find(c => c.startsWith(memberCookie+'=')).split(';')[0];
    const member = await state(session);
    assert.ok(member.memberId);
    outcome(await finish(cb,a.cookie),path+'/echec');
    const rows = () => owner.query("select count(*)::int as n from members.account");
    const count = (await rows()).rows[0].n;
    for (const [mode, suffix] of [['cancel','/annule'],['other','/echec'],['down','/echec']]) {
      const x = await start(), back = fixture.authorise(x.location, mode === 'other' ? {claims:{sub:'not-enrolled'}} : {unavailable:true});
      if (mode === 'cancel') { back.searchParams.delete('code'); back.searchParams.set('error','access_denied'); }
      const res = await finish(back,x.cookie+'; '+session);
      outcome(res,path+suffix);
      assert.equal(res.headers.getSetCookie().some(c=>c.startsWith(memberCookie+'=')), false);
      assert.equal((await rows()).rows[0].n,count);
      assert.equal((await state(session)).memberId,member.memberId);
    }
    const relog = await start(), signed = await finish(fixture.authorise(relog.location), relog.cookie+'; '+session);
    outcome(signed,'/');
    assert.equal((await get(session)).status,401);
    const renewed = signed.headers.getSetCookie().find(c => c.startsWith(memberCookie+'=')).split(';')[0];
    assert.equal((await state(renewed)).memberId,member.memberId);
    assert.equal((await end(renewed,{origin})).status,200);
    assert.equal((await get(renewed)).status,401);
    if (process.env.TEST_MEMBER_BROWSER === '1') {
      await pilot.test('Chromium carries only the Littora session back from cross-site consent', () =>
        require('../helpers/google-browser.cjs').checkGoogleBrowser({origin,login:local,session:url,fixture,memberCookie}));
    }
  });
});
