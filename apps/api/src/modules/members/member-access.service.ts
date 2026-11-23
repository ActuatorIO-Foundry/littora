import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class MemberAccess implements OnModuleDestroy {
  private pool?: Pool;
  private checked?: Promise<Pool>;
  readonly origin?: string;

  constructor() {
    try {
      const origin = new URL(process.env.MEMBER_PUBLIC_ORIGIN ?? '');
      const db = new URL(process.env.MEMBER_SESSION_DATABASE_URL ?? '');
      if (origin.protocol !== 'https:' || origin.origin !== process.env.MEMBER_PUBLIC_ORIGIN ||
          !['postgres:', 'postgresql:'].includes(db.protocol) || !db.username || !db.hostname ||
          !/^\/littora_members(_ci_[a-f0-9]{32})?$/.test(db.pathname)) return;
      this.origin = origin.origin;
      this.pool = new Pool({connectionString: db.href, max: 3, connectionTimeoutMillis: 2000, statement_timeout: 2500});
      this.pool.on('error', () => console.warn('{"event":"member_store_unavailable"}'));
    } catch { /* Optional account configuration must never block the public catalogue. */ }
  }

  async reader(): Promise<Pool> {
    if (!this.pool) throw new ServiceUnavailableException();
    this.checked ??= this.checkRole(this.pool).catch(() => {
      this.checked = undefined;
      throw new ServiceUnavailableException();
    });
    return this.checked;
  }

  private async checkRole(pool: Pool) {
    const { rows } = await pool.query(`select not rolsuper and not rolcreaterole and not rolcreatedb and not rolreplication
      and not pg_has_role(current_user,'littora_members_owner','MEMBER')
      and not pg_has_role(current_user,'littora_session_issuer','MEMBER')
      and not has_table_privilege(current_user,'members.session','SELECT')
      and not has_table_privilege(current_user,'members.account','SELECT')
      and not has_function_privilege(current_user,'members.start_session(text,text,bytea,bytea)','EXECUTE')
      and has_function_privilege(current_user,'members.read_session(bytea)','EXECUTE')
      and has_function_privilege(current_user,'members.end_session(bytea)','EXECUTE') as allowed
      from pg_roles where rolname = current_user`);
    if (!rows[0]?.allowed) throw new ServiceUnavailableException();
    return pool;
  }

  async onModuleDestroy() { await this.pool?.end(); }
}
