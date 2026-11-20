import { isIPv4 } from 'node:net';

// Validate the effective Compose values. Never include their contents in diagnostics.
export function validateProduction({ services, networks }) {
  const domain = services.caddy.environment.DOMAIN;
  if (typeof domain !== 'string' || domain.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) ||
      /(?:\.(?:localhost|internal|test|invalid|local|example)|\.home\.arpa)$/.test(domain)) {
    throw new Error('DOMAIN must be a public DNS hostname without scheme, port or path');
  }
  const pg = services.postgres.environment;
  const peer = services.api.environment.REPORT_PROXY_IPV4;
  if (!isIPv4(peer) || services.caddy.networks?.proxy_api?.ipv4_address !== peer) {
    throw new Error('REPORT_PROXY_IPV4 must match the dedicated Caddy network address');
  }
  const peers = Object.keys(services).filter(name => Object.hasOwn(services[name].networks ?? {}, 'proxy_api')).sort();
  if (!networks?.proxy_api?.internal || peers.join(',') !== 'api,caddy' || services.api.ports?.length) {
    throw new Error('proxy_api must be private to Caddy and the unpublished API');
  }
  if (!/^[a-f0-9]{64,}$/i.test(pg.POSTGRES_PASSWORD ?? '')) {
    throw new Error('POSTGRES_PASSWORD must be a random hexadecimal password of at least 64 characters');
  }
  for (const service of ['api', 'worker', 'migrate']) {
    let db;
    try { db = new URL(services[service].environment.DATABASE_URL); } catch {}
    if (!db || db.protocol !== 'postgresql:' || db.hostname !== 'postgres' ||
        !['', '5432'].includes(db.port) || db.username !== pg.POSTGRES_USER ||
        db.password !== pg.POSTGRES_PASSWORD || db.pathname !== '/' + pg.POSTGRES_DB || db.search || db.hash) {
      throw new Error('DATABASE_URL must match the configured internal PostgreSQL service and credentials');
    }
  }
}

export function dockerEnvironment() {
  // Local volume names, profiles and exported application secrets must not override .env.prod.
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(?:PATH|HOME|USER|TMPDIR|XDG_RUNTIME_DIR|SSH_AUTH_SOCK|DOCKER_[A-Z0-9_]+)$/.test(key)));
}
