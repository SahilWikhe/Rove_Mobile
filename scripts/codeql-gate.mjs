import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
export function blockingFindings(sarif) {
  if (!Array.isArray(sarif.runs) || !sarif.runs.length) throw new Error('Missing code scanning results');
  return sarif.runs.flatMap((run) => {
    const rules = new Map((run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule]));
    return (run.results ?? []).filter((result) => {
      const rule = rules.get(result.ruleId);
      const severity = Number(rule?.properties?.['security-severity'] ?? 0);
      return severity >= 4 || (result.level ?? rule?.defaultConfiguration?.level) === 'error';
    });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2] ?? 'reports/codeql';
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sarif'));
  if (!files.length) throw new Error('CodeQL did not produce a report');
  let count = 0;
  for (const file of files)
    count += blockingFindings(JSON.parse(await readFile(join(directory, file), 'utf8'))).length;
  console.log('Blocking code scanning findings: ' + count);
  if (count) process.exitCode = 1;
}
