import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { inspectEnvironment } from './environment-preflight';

// Read exactly one explicit file. Ambient credentials cannot fill missing settings by accident.
const filename = process.argv[2];
if (!filename || process.argv.length !== 3) {
  console.error('Usage: pnpm production:preflight /path/to/ignored-production.env');
  process.exitCode = 1;
} else {
  try {
    const result = inspectEnvironment(parseEnv(readFileSync(filename, 'utf8')), 'production');
    if (!result.valid) {
      console.error('Production configuration is incomplete or invalid: ' + result.problems.join(', '));
      process.exitCode = 1;
    } else {
      console.log('Production configuration shape passed. No network requests or deployment performed.');
      console.log(
        'Still verify provider credentials, database isolation/permissions, webhooks, queue and hosting plan.',
      );
    }
  } catch {
    // Filesystem/parser errors can embed private paths or input. Do not print the original error.
    console.error('Unable to read production environment file. No settings changed.');
    process.exitCode = 1;
  }
}
