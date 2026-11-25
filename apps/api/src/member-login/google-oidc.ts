import * as oidc from 'openid-client';

const issuer = 'https://accounts.google.com';
export const loginPath = '/connexion/google';
export const callbackPath = loginPath + '/retour';

export function googleClient(clientId: string, secret: string) {
  const config = new oidc.Configuration({
    issuer, authorization_endpoint: issuer + '/o/oauth2/v2/auth',
    token_endpoint: 'https://oauth2.googleapis.com/token',
    jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
    id_token_signing_alg_values_supported: ['RS256'],
  }, clientId, {client_secret: secret, id_token_signed_response_alg: 'RS256', [oidc.clockTolerance]: 5});
  config.timeout = 5;
  oidc.enableNonRepudiationChecks(config);
  return config;
}

export function newChallenge() {
  return {state: oidc.randomState(), nonce: oidc.randomNonce(), verifier: oidc.randomPKCECodeVerifier()};
}
export type Challenge = ReturnType<typeof newChallenge>;

export async function authorizationUrl(config: oidc.Configuration, redirect: string, tx: Challenge) {
  return oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirect, scope: 'openid', response_type: 'code', state: tx.state, nonce: tx.nonce,
    code_challenge_method: 'S256', code_challenge: await oidc.calculatePKCECodeChallenge(tx.verifier),
  });
}

export async function verifyGoogle(config: oidc.Configuration, callback: URL, tx: Challenge) {
  const tokens = await oidc.authorizationCodeGrant(config, callback, {
    pkceCodeVerifier: tx.verifier, expectedNonce: tx.nonce, expectedState: tx.state, idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims || claims.iss !== issuer || typeof claims.sub !== 'string' || !claims.sub ||
      (claims.azp !== undefined && claims.azp !== config.clientMetadata().client_id)) throw new Error('Invalid identity');
  return {issuer, subject: claims.sub};
}
