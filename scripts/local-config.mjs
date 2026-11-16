import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export function localPorts(env = process.env, envFile = new URL('../.env', import.meta.url)) {
  let file = {};
  try {
    file = parseEnv(readFileSync(envFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return Object.fromEntries(Object.entries({ API_PORT: 3000, WEB_PORT: 4200 }).map(([name, fallback]) => {
    const value = String(env[name] ?? file[name] ?? fallback);
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
      throw new Error(`${name} must be an integer between 1 and 65535`);
    }
    return [name, String(Number(value))];
  }));
}
