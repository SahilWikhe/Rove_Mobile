import { pathToFileURL } from 'node:url';
export const requiredJobs = [
  'quality',
  'tests',
  'browser',
  'mobile',
  'native-android',
  'native-ios',
  'security',
  'codeql',
  'infrastructure',
];
export function gateFailures(results) {
  if (!results || typeof results !== 'object') return ['Missing job results'];
  return requiredJobs
    .filter((name) => results[name]?.result !== 'success')
    .map((name) => name + ' did not succeed');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = gateFailures(JSON.parse(process.env.JOB_RESULTS ?? 'null'));
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log('All required CI jobs passed.');
}
