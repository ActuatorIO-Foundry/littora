// Explicit subprocess double: the watch-mode smoke test never reaches a database.
if (process.env.NODE_ENV !== 'test') throw new Error('Test-only database double');
const assert = require('node:assert/strict');
const { manifest } = require('../../scripts/database.cjs');
require('pg').Pool = class {
  async query(sql) {
    assert.match(sql, /^select /i);
    if (sql.includes('to_regclass')) return { rows: [{ name: 'schema_migrations' }] };
    assert.match(sql, /from public.schema_migrations/);
    return { rows: manifest() };
  }
  async end() {}
};
