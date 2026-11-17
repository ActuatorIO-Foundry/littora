import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkReport(image, report, exceptions, today = new Date().toISOString().slice(0, 10)) {
  if (report.SchemaVersion !== 2 || !Array.isArray(report.Results) || !report.Metadata?.OS) {
    throw new Error('Incomplete image scan report');
  }
  const blocked = [], accepted = [];
  for (const result of report.Results) for (const item of result.Vulnerabilities ?? []) {
    if (!['HIGH', 'CRITICAL'].includes(item.Severity)) continue;
    const exception = exceptions.find((e) => e.image === image && e.id === item.VulnerabilityID &&
      e.package === item.PkgName && e.version === item.InstalledVersion &&
      e.expires > today && !item.FixedVersion);
    (exception ? accepted : blocked).push(`${item.VulnerabilityID} ${item.PkgName} ${item.InstalledVersion}`);
  }
  return { blocked, accepted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [image, file] = process.argv.slice(2);
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const exceptions = JSON.parse(readFileSync(new URL('../infra/security-exceptions.json', import.meta.url), 'utf8'));
  const result = checkReport(image, report, exceptions);
  console.log(JSON.stringify({ image, ...result }));
  if (result.blocked.length) process.exitCode = 1;
}
