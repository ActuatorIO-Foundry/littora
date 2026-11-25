import { randomBytes } from 'node:crypto';
import { Challenge, newChallenge } from './google-oidc';

export const attemptCookie = '__Host-littora-login';
export const attemptLifetime = 5 * 60_000;

export function browserHandle(header?: string) {
  const parts = (header ?? '').split(';').map(c => c.trim()).filter(c => c.startsWith(attemptCookie + '='));
  const handle = parts.length === 1 ? parts[0].slice(attemptCookie.length + 1) : '';
  return /^[0-9a-f]{64}$/.test(handle) ? handle : undefined;
}

// Recette mono-instance : un redémarrage annule les tentatives, jamais les sessions.
export class LoginAttempts {
  private readonly pending = new Map<string, {expires: number; tx: Challenge}>();
  constructor(private readonly now = Date.now, private readonly limit = 256) {}

  start(previous?: string) {
    const now = this.now();
    for (const [handle, entry] of this.pending) if (entry.expires <= now) this.pending.delete(handle);
    if (previous) this.pending.delete(previous);
    if (this.pending.size >= this.limit) return null;
    const handle = randomBytes(32).toString('hex'), tx = newChallenge();
    this.pending.set(handle, {expires: now + attemptLifetime, tx});
    return {handle, tx};
  }

  take(handle: string | undefined, state: string | null) {
    if (!handle) return null;
    const entry = this.pending.get(handle);
    if (!entry || entry.tx.state !== state) return null;
    this.pending.delete(handle);
    return entry.expires > this.now() ? entry.tx : null;
  }
}
