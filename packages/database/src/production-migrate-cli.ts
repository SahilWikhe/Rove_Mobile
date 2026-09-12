import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { loadReleaseMigrations, releaseMigrations, releaseTarget } from './release-migrations';

const [mode, filename, planHash, ...extra] = process.argv.slice(2);
if (
  !['plan', 'apply'].includes(mode ?? '') ||
  !filename ||
  extra.length ||
  (mode === 'plan' && planHash !== undefined) ||
  (mode === 'apply' && !/^[a-f0-9]{64}$/.test(planHash ?? '')) ||
  process.env.VERCEL
) {
  console.error('Usage: pnpm db:production:migrate plan <env-file> | apply <env-file> <reviewed-plan-hash>');
  process.exitCode = 1;
} else {
  let pool: Pool | undefined;
  try {
    // Ambient database credentials never fill omitted file settings.
    const config = releaseTarget(parseEnv(readFileSync(filename, 'utf8')));
    const migrations = loadReleaseMigrations(fileURLToPath(new URL('../migrations/', import.meta.url)));
    pool = new Pool({ connectionString: config.connectionString, max: 1, connectionTimeoutMillis: 10000 });
    const client = await pool.connect();
    try {
      console.log(
        JSON.stringify(await releaseMigrations(client, config.target, migrations, planHash), null, 2),
      );
    } finally {
      client.release(true);
    }
  } catch {
    console.error(
      'Production migration failed. Check target, role separation, journal, lock and reviewed plan; private error details withheld.',
    );
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
