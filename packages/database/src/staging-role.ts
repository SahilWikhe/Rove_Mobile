import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { stagingUrl } from './staging-config';

// Run from repo root after migrations. Runtime credentials are never schema-owner credentials.
const file = '.env.neon.staging';
const original = await readFile(file, 'utf8');
const direct = stagingUrl(process.env, false);
const runtime = new URL(stagingUrl(process.env, true));
const pool = new Pool({ connectionString: direct, max: 1 });
try {
  const exists = (await pool.query("SELECT 1 FROM pg_roles WHERE rolname='rove_staging_app'")).rowCount;
  if (!exists) {
    const password = randomBytes(32).toString('hex');
    // Generated hex only, never untrusted text or a SQL log parameter.
    await pool.query(
      `CREATE ROLE rove_staging_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`,
    );
    runtime.username = 'rove_staging_app';
    runtime.password = password;
    const updated = original.replace(/^DATABASE_URL=.*$/m, 'DATABASE_URL=' + runtime.toString());
    await writeFile(file, updated, { mode: 0o600 });
  } else if (runtime.username !== 'rove_staging_app') {
    throw new Error('Existing runtime role requires its own saved credentials; do not reset automatically.');
  }
  await pool.query(`
    GRANT CONNECT ON DATABASE neondb TO rove_staging_app;
    GRANT USAGE ON SCHEMA public TO rove_staging_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rove_staging_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rove_staging_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rove_staging_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rove_staging_app;
  `);
  console.log('Staging application role configured; schema-owner credentials remain migration-only.');
} catch {
  console.error('Staging role setup failed; details withheld. Existing credentials were not reset.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
