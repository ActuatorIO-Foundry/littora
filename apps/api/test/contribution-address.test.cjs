const assert = require('node:assert/strict');
const { test } = require('node:test');
const { contributionAddress } = require('../dist/modules/reports/contribution-address');

const proxy = '192.0.2.10';
const request = (peer, forwarded) => ({ socket: { remoteAddress: peer }, headers: { 'x-forwarded-for': forwarded } });
const unavailable = error => error.getStatus() === 503;

test('direct contributions preserve the socket identity regardless of HTTP metadata', () => {
  assert.equal(contributionAddress(request('::ffff:192.0.2.12', '198.51.100.5')), '::ffff:192.0.2.12');
  assert.throws(() => contributionAddress(request(undefined, '198.51.100.5')), unavailable);
});

test('proxied contributions require exactly one observed client from the configured peer', () => {
  for (const peer of [proxy, '::ffff:192.0.2.10', '::FFFF:C000:020A']) {
    assert.equal(contributionAddress(request(peer, '::ffff:198.51.100.5'), proxy), '198.51.100.5');
    assert.equal(contributionAddress(request(peer, '2001:0db8::1'), proxy), '2001:db8::1');
  }
  for (const header of [undefined, '', 'unknown', ['192.0.2.1'], '192.0.2.1, 192.0.2.2', 'fe80::1%eth0']) {
    assert.throws(() => contributionAddress(request(proxy, header), proxy), unavailable);
  }
  assert.throws(() => contributionAddress(request('192.0.2.11', '198.51.100.5'), proxy), unavailable);
  for (const badProxy of ['', 'some-host', '192.0.2.0/24']) {
    assert.throws(() => contributionAddress(request(proxy, '198.51.100.5'), badProxy), unavailable);
  }
});
