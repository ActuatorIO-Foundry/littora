import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { localPorts } from './local-config.mjs';

const cwd = fileURLToPath(new URL('../apps/web/', import.meta.url));
const ports = localPorts();
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const child = spawn(process.execPath, [
  require.resolve('@angular/cli/bin/ng.js'), 'serve', '--host', '127.0.0.1',
  '--port', ports.WEB_PORT, '--proxy-config', 'proxy.local.cjs',
], { cwd, env: { ...process.env, ...ports }, stdio: ['inherit','pipe','pipe'] });

// The dev proxy can include the full requested URL in an error, including coordinates.
for (const stream of [child.stdout, child.stderr]) {
  createInterface({input:stream}).on('line', line => {
    if (/error|failed/i.test(line)) console.error('{"event":"dev_web_error"}');
    else if (/Local:/.test(line)) console.info('Local: http://127.0.0.1:' + ports.WEB_PORT);
    else if (/Application bundle generation complete/.test(line)) console.info('{"event":"dev_web_ready"}');
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', () => { console.error('{"event":"dev_web_startup_failed"}'); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
