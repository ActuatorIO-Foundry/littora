import { Controller, Get, Inject, Injectable, OnModuleDestroy, Post, Req, Res } from '@nestjs/common';
import type {Request, Response} from 'express';
import {Pool} from 'pg';
import {memberSessionDigest} from '../modules/members/member-session';
import {loginPath} from './google-oidc';
import {loginPage, sameOriginPost} from './login-page';
import {loginSettings, LoginSettings} from './login-settings';

export const privacyPath = loginPath + '/confidentialite';

@Injectable()
export class MemberPrivacy implements OnModuleDestroy {
  private readonly pool?: Pool;
  constructor(@Inject(loginSettings) settings: LoginSettings) {
    if (!settings.privacyDsn) return;
    this.pool = new Pool({connectionString:settings.privacyDsn,max:2,connectionTimeoutMillis:2000,statement_timeout:2500});
    this.pool.on('error', () => console.warn('{"event":"member_privacy_store_unavailable"}'));
  }

  async perform(action: 'export'|'erase', proof: Buffer) {
    if (!this.pool) throw new Error('Unavailable');
    const {rows} = await this.pool.query(`select not rolsuper and not rolbypassrls and not rolcreaterole
      and not rolcreatedb and not rolreplication and pg_has_role(current_user,'littora_member_privacy','MEMBER')
      and not exists(select from unnest(array['littora_members_owner','littora_session_reader','littora_session_issuer']) role_name
        where pg_has_role(current_user,role_name,'MEMBER'))
      and not exists(select from unnest(array['members.account','members.session','members.erasure_request']) tbl
        where has_table_privilege(current_user,tbl,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
      and not has_function_privilege(current_user,'members.start_session(text,text,bytea,bytea)','EXECUTE')
      and not has_function_privilege(current_user,'members.end_session(bytea)','EXECUTE')
      and not has_function_privilege(current_user,'members.read_session(bytea)','EXECUTE')
      and not has_function_privilege(current_user,'members.complete_erasure(uuid,timestamptz)','EXECUTE')
      as allowed from pg_roles where rolname=current_user`);
    if (!rows[0]?.allowed) throw new Error('Unexpected privacy privileges');
    const sql = action === 'export' ? 'select members.export_self($1) as result' : 'select members.request_erasure($1) as result';
    return (await this.pool.query(sql,[proof])).rows[0]?.result;
  }

  async onModuleDestroy() { await this.pool?.end(); }
}

@Controller(privacyPath)
export class MemberPrivacyController {
  constructor(@Inject(loginSettings) private readonly settings: LoginSettings, private readonly store: MemberPrivacy) {}

  @Get()
  form(@Res() res: Response) {
    if (!this.settings.privacyDsn) return res.sendStatus(503);
    res.set('Referrer-Policy','same-origin').send(loginPage('<h2>Mes données</h2>' +
      '<p>Le fichier contient vos identifiants et les échéances de vos sessions Littora. Il ne contient aucun secret de connexion.</p>' +
      '<form method="post" action="' + privacyPath + '/export"><button>Télécharger mes données</button></form>' +
      '<h2>Effacement du compte</h2><p>Cette demande sera vérifiée avant la suppression du compte et de toutes ses sessions. Elle ne concerne pas le compte Google ni les contributions anonymes.</p>' +
      '<form method="post" action="' + privacyPath + '/effacement"><button>Confirmer ma demande d’effacement</button></form>'));
  }

  @Post('export')
  export(@Req() req: Request, @Res() res: Response) { return this.handle('export',req,res); }
  @Post('effacement')
  erase(@Req() req: Request, @Res() res: Response) { return this.handle('erase',req,res); }

  private async handle(action: 'export'|'erase', req: Request, res: Response) {
    if (!this.settings.privacyDsn) return res.sendStatus(503);
    if (!sameOriginPost(req,this.settings.origin)) return res.sendStatus(403);
    if (req.originalUrl.includes('?') || req.headers['transfer-encoding'] ||
        (req.headers['content-length'] && req.headers['content-length'] !== '0')) return res.sendStatus(400);
    const proof = memberSessionDigest(req.headers.cookie);
    const signIn = () => res.status(401).send(loginPage('<p>Connectez-vous de nouveau à Littora, puis revenez sur cette page dans les dix minutes.</p><a href="/connexion/google">Se connecter</a>'));
    if (!proof) return signIn();
    try {
      const result = await this.store.perform(action,proof);
      if (result == null) return signIn();
      if (action === 'export') return res.attachment('littora-mes-donnees.json').json(result);
      return res.status(202).send(loginPage('<h2>Demande enregistrée</h2><p>Votre compte n’est pas encore supprimé.</p><a href="/">Retour à Littora</a>'));
    } catch { return res.sendStatus(503); }
  }
}
