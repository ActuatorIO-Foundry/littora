import { ServiceUnavailableException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { isIP, isIPv4, SocketAddress } from 'node:net';

function canonical(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.includes('%')) return;
  if (isIPv4(value)) return value;
  if (isIP(value) === 6) {
    const address = new SocketAddress({ address: value, family: 'ipv6' }).address;
    return address.replace(/^::ffff:(?=\d+\.)/, '');
  }
}

export function contributionAddress(request: Pick<IncomingMessage, 'headers' | 'socket'>,
  proxy: string | undefined = process.env.REPORT_PROXY_IPV4): string {
  const peer = request.socket.remoteAddress;
  // Preserve the existing direct-mode quota keys. No HTTP header is authoritative here.
  if (proxy === undefined && peer && isIP(peer)) return peer;
  if (proxy && isIPv4(proxy) && canonical(peer) === proxy) {
    const client = canonical(request.headers['x-forwarded-for']);
    if (client) return client;
  }
  throw new ServiceUnavailableException();
}
