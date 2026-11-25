import { Pool } from 'pg';

export function contactPool(dsn: string) {
  const url = new URL(dsn);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^\/littora_contact(_ci_[a-f0-9]{32})?$/.test(url.pathname)) {
    throw new Error('Expected a dedicated contact database');
  }
  const pool = new Pool({connectionString:dsn, max:3, connectionTimeoutMillis:2000, statement_timeout:5000});
  pool.on('error', () => console.error('contact_storage_unavailable'));
  return pool;
}

export async function verifyContactRole(pool: Pool, manager: boolean) {
  const {rows:[r]} = await pool.query(`select
    has_function_privilege('inbox.submit(text,text,text,text)','execute') as submit,
    has_function_privilege('inbox.open_mail()','execute') as manage,
    has_function_privilege('inbox.read_mail(uuid)','execute') as read,
    has_function_privilege('inbox.resolve(uuid)','execute') as resolve,
    has_table_privilege('inbox.message','select,insert,update,delete') as direct`);
  if (r.submit === manager || r.manage !== manager || r.read !== manager || r.resolve !== manager || r.direct) {
    throw new Error('Invalid contact database role');
  }
}
