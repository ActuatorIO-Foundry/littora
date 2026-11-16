const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { test } = require('node:test');

// Resolve the dependency actually used by Nest's Express adapter, including nested installs.
const platformRequire = createRequire(require.resolve('@nestjs/platform-express/package.json'));
const expressRequire = createRequire(platformRequire.resolve('express/package.json'));
const proxyaddr = expressRequire('proxy-addr');

test('GHSA-jqcg-44mw-7w3h: an IPv6 trust prefix cannot trust arbitrary IPv4 clients', () => {
  const trust = proxyaddr.compile('::ffff:10.0.0.0/8');
  const request = {
    socket: { remoteAddress: '198.51.100.10' },
    headers: { 'x-forwarded-for': '192.0.2.50' },
  };
  assert.equal(trust(request.socket.remoteAddress), false);
  assert.equal(proxyaddr(request, trust), request.socket.remoteAddress);
});

test('proxy trust: correctly scoped IPv4 and mapped IPv6 proxies remain supported', () => {
  const request = {
    socket: { remoteAddress: '10.1.2.3' },
    headers: { 'x-forwarded-for': '192.0.2.50' },
  };
  for (const subnet of ['10.0.0.0/8', '::ffff:10.0.0.0/104']) {
    const trust = proxyaddr.compile(subnet);
    assert.equal(trust('198.51.100.10'), false);
    assert.equal(proxyaddr(request, trust), '192.0.2.50');
  }
});
