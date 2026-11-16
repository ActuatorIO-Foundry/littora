import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localPorts } from './local-config.mjs';

const cwd = fileURLToPath(new URL('../apps/web/', import.meta.url));
const ports = localPorts();
const child = spawn(process.execPath, [
  'node_modules/@angular/cli/bin/ng.js', 'serve', '--host', '127.0.0.1',
  '--port', ports.WEB_PORT, '--proxy-config', 'proxy.local.cjs',
], { cwd, env: { ...process.env, ...ports }, stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
