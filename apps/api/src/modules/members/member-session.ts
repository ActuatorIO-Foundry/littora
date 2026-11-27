import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';

export const memberCookie = '__Host-littora-member';
export const cookieScope = { path: '/', secure: true, httpOnly: true, sameSite: 'lax' as const };
const tokenPattern = /^[a-f0-9]{64}$/;
const digest = (value: string) => createHash('sha256').update(value).digest();

function memberTokens(header?: string) {
  const cookies = header?.split(';').map(part => part.trim()).filter(part => part.startsWith(memberCookie + '=')) ?? [];
  return cookies.map(part => part.slice(memberCookie.length + 1));
}
const singleDigest = (values: string[]) => values.length === 1 && tokenPattern.test(values[0]) ? digest(values[0]) : null;
export const memberSessionDigest = (header?: string) => singleDigest(memberTokens(header));

// Internal only: the identity adapter must verify the provider and all required factors first.
// The HTTP reader has no permission to call start_session, even with its own credentials.
export async function establishMemberSession(issuerPool: Pool, identity: {issuer: string; subject: string}, previousCookie?: string) {
  const value = randomBytes(32).toString('hex');
  const {rows} = await issuerPool.query('select * from members.start_session($1,$2,$3,$4)',
    [identity.issuer, identity.subject, digest(value), memberSessionDigest(previousCookie)]);
  return {name: memberCookie, value, options: {...cookieScope, expires: rows[0].expires_at as Date}};
}

export async function readMemberSession(pool: Pool, header?: string) {
  const key = memberSessionDigest(header);
  if (!key) return null;
  const {rows} = await pool.query('select * from members.read_session($1)', [key]);
  return rows.length ? {memberId: rows[0].member_id as string, expiresAt: (rows[0].expires_at as Date).toISOString()} : null;
}

export async function revokeMemberSession(pool: Pool, header?: string) {
  const values = memberTokens(header);
  if (values.length > 1) return false;
  const key = singleDigest(values);
  if (key) await pool.query('select members.end_session($1)', [key]);
  return true;
}
