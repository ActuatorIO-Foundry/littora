const {generateKeyPairSync, createHash, sign, randomUUID} = require('node:crypto');
const {customFetch} = require('openid-client');
const {googleClient} = require('../../dist/member-login/google-oidc');

// No listener or external request: the OIDC library uses a private test transport.
function googleFixture() {
  const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength:2048});
  const clientId = 'recette.apps.googleusercontent.com', secret = randomUUID();
  const config = googleClient(clientId, secret);
  const issuer = 'https://accounts.google.com', codes = new Map();
  const jwk = {...publicKey.export({format:'jwk'}), kid:'recette', alg:'RS256', use:'sig'};
  function authorise(location, changes = {}) {
    const params = new URL(location).searchParams;
    const code = randomUUID(), url = new URL(params.get('redirect_uri'));
    url.searchParams.set('state', params.get('state')); url.searchParams.set('code', code);
    codes.set(code, {params, changes});
    return url;
  }
  config[customFetch] = async (url, options) => {
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({keys:[jwk]});
    if (url !== 'https://oauth2.googleapis.com/token') throw new Error('Unexpected endpoint');
    const form = new URLSearchParams(options.body);
    const entry = codes.get(form.get('code'));
    codes.delete(form.get('code'));
    if (!entry || form.get('client_id') !== clientId || form.get('client_secret') !== secret ||
        form.get('grant_type') !== 'authorization_code' || form.get('redirect_uri') !== entry.params.get('redirect_uri') ||
        createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== entry.params.get('code_challenge'))
      return Response.json({error:'invalid_grant'}, {status:400});
    const {claims, unavailable, signer} = entry.changes;
    if (unavailable) return new Response(null, {status:503});
    const now = Math.floor(Date.now()/1000);
    const payload = {iss:issuer, sub:'test-sub', aud:clientId, nonce:entry.params.get('nonce'), iat:now, exp:now+120, ...claims};
    const encoded = [{alg:'RS256', kid:jwk.kid},payload].map(p=>Buffer.from(JSON.stringify(p)).toString('base64url')).join('.');
    const id_token = encoded + '.' + sign('RSA-SHA256', Buffer.from(encoded), signer ?? privateKey).toString('base64url');
    return Response.json({id_token, token_type:'Bearer',access_token:'fixture-only'});
  };
  return {authorise, config, clientId, secret};
}
module.exports = {googleFixture};
