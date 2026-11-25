import { Pool } from 'pg';

export const loginSettings = Symbol('loginSettings');
export type LoginSettings = ReturnType<typeof readSettings>;

export function readSettings(env: NodeJS.ProcessEnv = process.env) {
  const origin = new URL(env.MEMBER_PUBLIC_ORIGIN ?? '');
  const dsn = new URL(env.MEMBER_ISSUER_DATABASE_URL ?? '');
  const clientId = env.GOOGLE_CLIENT_ID, secret = env.GOOGLE_CLIENT_SECRET, subject = env.GOOGLE_TEST_SUBJECT;
  if (env.MEMBER_GOOGLE_MODE !== 'recette' || origin.protocol !== 'https:' || origin.origin !== env.MEMBER_PUBLIC_ORIGIN ||
      !['postgresql:', 'postgres:'].includes(dsn.protocol) || !dsn.username || !dsn.hostname ||
      !/^\/littora_members(_ci_[a-f0-9]{32})?$/.test(dsn.pathname) ||
      !clientId?.endsWith('.apps.googleusercontent.com') || !secret || !subject || Buffer.byteLength(subject) > 255)
    throw new Error('Invalid private login configuration');
  return {origin: origin.origin, dsn: dsn.href, clientId, secret, subject};
}

export class SessionIssuer {
  private readonly pool: Pool;
  constructor(settings: LoginSettings) {
    this.pool = new Pool({connectionString: settings.dsn, max: 3, connectionTimeoutMillis: 2500, statement_timeout: 2500});
    this.pool.on('error', () => console.warn('{"event":"member_issuer_unavailable"}'));
  }

  async ready() {
    const {rows} = await this.pool.query(`select not rolsuper and not rolcreaterole and not rolcreatedb
      and not rolreplication and not rolbypassrls
      and not pg_has_role(current_user,'littora_members_owner','MEMBER')
      and not pg_has_role(current_user,'littora_session_reader','MEMBER')
      and not has_table_privilege(current_user,'members.account','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      and not has_table_privilege(current_user,'members.session','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      and not has_function_privilege(current_user,'members.read_session(bytea)','EXECUTE')
      and not has_function_privilege(current_user,'members.end_session(bytea)','EXECUTE')
      and has_function_privilege(current_user,'members.start_session(text,text,bytea,bytea)','EXECUTE') as allowed
      from pg_roles where rolname = current_user`);
    if (!rows[0]?.allowed) throw new Error('Unexpected issuer privileges');
    return this.pool;
  }
  async onModuleDestroy() { await this.pool.end(); }
}
