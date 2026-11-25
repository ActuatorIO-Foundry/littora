const {test} = require('node:test');
const assert = require('node:assert/strict');
const {generateKeyPairSync} = require('node:crypto');
const {googleFixture} = require('./helpers/google-provider.cjs');
const {callbackPath, authorizationUrl, verifyGoogle, newChallenge} = require('../dist/member-login/google-oidc');
const {readSettings} = require('../dist/member-login/login-settings');
const {LoginAttempts, attemptCookie, attemptLifetime, browserHandle} = require('../dist/member-login/login-attempts');

test('Google OIDC: verified issuer and subject only, S256 and minimal scope', async () => {
  const fixture = googleFixture();
  const tx = newChallenge();
  const redirect = 'https://recette.example' + callbackPath;
  const location = await authorizationUrl(fixture.config, redirect, tx);
  assert.equal(location.origin,'https://accounts.google.com');
  assert.equal(location.searchParams.get('scope'),'openid');
  assert.equal(location.searchParams.get('code_challenge_method'),'S256');
  assert.equal(location.searchParams.has('client_secret'),false);
  assert.ok(!location.href.includes(tx.verifier));
  const callback = fixture.authorise(location);
  assert.deepEqual(await verifyGoogle(fixture.config, callback, tx), {issuer:location.origin, subject:'test-sub'});
  await assert.rejects(verifyGoogle(fixture.config, callback, tx));
});

test('OIDC: reject unverified responses, expired credentials and provider outage', async () => {
  const {config, authorise} = googleFixture();
  const tx = newChallenge();
  const location = await authorizationUrl(config, 'https://recette.example' + callbackPath, tx);
  for (const claims of [{iss:'https://other.example'}, {aud:'other'}, {azp:'other'}, {exp:1}, {nonce:'different'}]) {
    await assert.rejects(verifyGoogle(config, authorise(location, {claims}), tx));
  }
  const {privateKey} = generateKeyPairSync('rsa', {modulusLength:2048});
  await assert.rejects(verifyGoogle(config, authorise(location, {signer:privateKey}), tx));
  await assert.rejects(verifyGoogle(config, authorise(location, {unavailable:true}), tx));
  for (const key of ['state','verifier']) await assert.rejects(verifyGoogle(config, authorise(location), {...tx,[key]:'different'}));
});

test('login attempts are isolated, bounded, expire after five minutes and cannot be consumed twice', () => {
  let now = 0;
  const attempts = new LoginAttempts(() => now, 2);
  const a = attempts.start(), b = attempts.start();
  assert.equal(attempts.start(),null);
  assert.equal(attempts.take(a.handle,b.tx.state),null);
  assert.equal(browserHandle(attemptCookie+'='+a.handle+'; '+attemptCookie+'='+b.handle),undefined);
  assert.deepEqual(attempts.take(a.handle,a.tx.state),a.tx);
  assert.equal(attempts.take(a.handle,a.tx.state),null);
  const c = attempts.start(b.handle);
  assert.equal(attempts.take(b.handle,b.tx.state),null);
  now += attemptLifetime;
  assert.equal(attempts.take(c.handle,c.tx.state),null);
  assert.ok(attempts.start());
});

test('no implicit enablement, public catalogue storage, insecure origin or open enrolment', () => {
  const base = {MEMBER_GOOGLE_MODE:'recette', MEMBER_PUBLIC_ORIGIN:'https://recette.example',
    MEMBER_ISSUER_DATABASE_URL:'postgresql://issuer@db/littora_members', GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET:'test', GOOGLE_TEST_SUBJECT:'test-sub'};
  assert.ok(readSettings(base));
  for (const override of [{MEMBER_GOOGLE_MODE:''}, {MEMBER_PUBLIC_ORIGIN:'http://recette.example'},
    {MEMBER_ISSUER_DATABASE_URL:'postgresql://issuer@db/littora'}, {GOOGLE_TEST_SUBJECT:''}, {GOOGLE_CLIENT_SECRET:''}])
    assert.throws(() => readSettings({...base,...override}));
});
