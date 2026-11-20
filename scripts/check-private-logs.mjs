import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Triage, not proof of absence: arbitrary private prose cannot be classified reliably.
const markers = Object.entries({
  connection: /(?:postgres(?:ql)?|rediss?):\/\/[^\s/@]+:[^\s/@]+@/i,
  credential: /(?:\bbearer\s+[A-Za-z0-9._~+/-]{8,}|(?:password|authorization|api[_-]?key|cookie)["']?\s*[:=]\s*["']?[^\s"',}]{4,})/i,
  location: /(?:[?&]|")\b(?:lat|lon|latitude|longitude)\b["']?\s*[:=]\s*[-\d]|open-meteo(?:-marine)?\s+-?\d+\/-?\d+:/i,
  request: /^\S+ - \S+ \[|"(?:remote_ip|client_ip|remote_addr)"\s*:/i,
  sql: /\b(?:STATEMENT:\s|DETAIL:\s+parameters:)/i,
  email: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
});
export function countIndicators(captured) {
  let lines = 0, flagged = 0;
  const categories = {};
  for (const line of captured.split(/\r?\n/)) {
    if (!line) continue;
    lines++;
    const matches = markers.filter(([,pattern]) => pattern.test(line));
    if (matches.length) flagged++;
    for (const [kind] of matches) categories[kind] = (categories[kind] ?? 0) + 1;
  }
  return {lines, flagged, categories};
}
const run = args => {
  const result = spawnSync('docker',args,{encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024});
  if (result.status !== 0 || result.error) throw Error('Incomplete inspection');
  return result.stdout + result.stderr;
};
function main(project) {
  if (!/^[a-z0-9][a-z0-9_-]{0,100}$/.test(project ?? '')) throw Error('Expected Compose project');
  const services = new Set(['api','worker','inventories','postgres','redis','redis-jobs','web','caddy','migrate']);
  const rows = run(['ps','--filter','label=com.docker.compose.project='+project,'--format',
    '{{.ID}} {{.Label "com.docker.compose.service"}}']).trim().split('\n');
  let flagged = false, inspected = 0;
  for (const row of rows) {
    const [id,service] = row.split(' ');
    if (!/^[a-f0-9]{12,64}$/.test(id) || !services.has(service)) continue;
    const counts = countIndicators(run(['logs','--since','24h','--tail','2000',id]));
    console.log(JSON.stringify({service,...counts}));
    flagged ||= counts.flagged > 0;
    inspected++;
  }
  if (!inspected) throw Error('No running services');
  return flagged ? 2 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = main(process.argv[2]); }
  catch { console.error('Inspection incomplete: check project, Docker access and sample size.'); process.exitCode = 1; }
}
