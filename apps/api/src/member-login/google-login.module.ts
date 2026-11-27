import { Controller, Get, Inject, INestApplication, Module, Post, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { Configuration } from 'openid-client';
import { establishMemberSession, cookieScope } from '../modules/members/member-session';
import { authorizationUrl, callbackPath, googleClient, loginPath, verifyGoogle } from './google-oidc';
import { attemptCookie, attemptLifetime, browserHandle, LoginAttempts } from './login-attempts';
import { loginSettings, LoginSettings, readSettings, SessionIssuer } from './login-settings';
import { loginPage as page, sameOriginPost } from './login-page';
import { MemberPrivacy, MemberPrivacyController, privacyPath } from './member-privacy';

export const provider = Symbol('googleClient');

@Controller(loginPath)
class GoogleLoginController {
  constructor(@Inject(loginSettings) private readonly settings: LoginSettings,
    @Inject(provider) private readonly client: Configuration,
    private readonly attempts: LoginAttempts, private readonly issuer: SessionIssuer) {}

  @Get()
  form(@Res() res: Response) {
    // The browser needs its Origin for the same-origin form POST, never for a third party.
    const privacy = this.settings.privacyDsn ? '<p><a href="' + privacyPath + '">Mes données Littora</a></p>' : '';
    res.set('Referrer-Policy','same-origin').send(page('<form method="post" action="/connexion/google"><button>Continuer avec Google</button></form>' + privacy));
  }

  @Post()
  async start(@Req() req: Request, @Res() res: Response) {
    if (!sameOriginPost(req,this.settings.origin)) return res.sendStatus(403);
    const attempt = this.attempts.start(browserHandle(req.headers.cookie));
    if (!attempt) return res.set('Retry-After', String(attemptLifetime / 1000)).sendStatus(429);
    const location = await authorizationUrl(this.client, this.settings.origin + callbackPath, attempt.tx);
    res.cookie(attemptCookie, attempt.handle, {...cookieScope, maxAge: attemptLifetime});
    return res.redirect(303, location.href);
  }

  @Get('retour')
  async callback(@Req() req: Request, @Res() res: Response) {
    // Never derive the token exchange redirect_uri or any destination from the Host header.
    const url = new URL(this.settings.origin + callbackPath);
    const queryStart = req.originalUrl.indexOf('?');
    if (queryStart !== -1) url.search = req.originalUrl.slice(queryStart);
    const q = url.searchParams;
    const failed = () => res.redirect(303, loginPath + '/echec');
    if (q.getAll('state').length !== 1) return failed();
    const tx = this.attempts.take(browserHandle(req.headers.cookie), q.get('state'));
    if (!tx) return failed();
    res.clearCookie(attemptCookie, cookieScope);
    if (q.has('error')) {
      return q.getAll('error').length === 1 && q.get('error') === 'access_denied' && !q.has('code')
        ? res.redirect(303, loginPath + '/annule') : failed();
    }
    if (q.getAll('code').length !== 1 || !q.get('code')) return failed();
    try {
      const identity = await verifyGoogle(this.client, url, tx);
      // Only the pre-authorised staging account, until member MFA is available.
      if (identity.subject !== this.settings.subject) return failed();
      const session = await establishMemberSession(await this.issuer.ready(), identity, req.headers.cookie);
      res.cookie(session.name, session.value, session.options);
    } catch { return failed(); }
    return res.redirect(303, '/');
  }

  @Get('annule')
  cancelled(@Res() res: Response) {
    res.send(page('<p>Connexion annulée.</p><a href="/connexion/google">Recommencer</a>'));
  }

  @Get('echec')
  failed(@Res() res: Response) {
    res.status(400).send(page('<p>La connexion n’a pas abouti.</p><a href="/connexion/google">Réessayer</a>'));
  }
}

@Module({controllers:[GoogleLoginController,MemberPrivacyController], providers:[MemberPrivacy,
  {provide: loginSettings, useFactory: () => readSettings()},
  {provide: provider, useFactory: (s: LoginSettings) => googleClient(s.clientId, s.secret), inject:[loginSettings]},
  {provide: SessionIssuer, useFactory: (s: LoginSettings) => new SessionIssuer(s), inject:[loginSettings]},
  {provide: LoginAttempts, useFactory: () => new LoginAttempts()},
]})
export class GoogleLoginModule {}

export function secureLoginResponses(app: INestApplication) {
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.set({'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; form-action 'self' https://accounts.google.com; base-uri 'none'; frame-ancestors 'none'"});
    next();
  });
}
