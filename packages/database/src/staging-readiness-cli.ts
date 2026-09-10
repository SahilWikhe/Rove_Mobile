import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { TLSSocket } from 'node:tls';
import { Pool } from 'pg';
import { stagingUrl } from './staging-config';
import { inspectStagingPermissions } from './staging-readiness';

const filename = process.argv[2];
if (!filename || process.argv.length !== 3) {
  console.error('Usage: pnpm db:staging:check /path/to/ignored-staging.env');
  process.exitCode = 1;
} else {
  let pool: Pool | undefined;
  let stage = 'configuration';
  try {
    // Never fill missing file settings with ambient database credentials.
    const connectionString = stagingUrl(parseEnv(readFileSync(filename, 'utf8')), true);
    pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
    stage = 'connection';
    const client = await pool.connect();
    try {
      stage = 'read-only transaction';
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '10s'");
      stage = 'TLS';
      // Neon pooling terminates client TLS before the PostgreSQL backend connection.
      // pg_stat_ssl describes that backend hop, not the certificate we authenticated.
      const socket = (client as unknown as { connection: { stream: unknown } }).connection.stream;
      if (!(socket instanceof TLSSocket) || !socket.encrypted || !socket.authorized)
        throw new Error('Verified client TLS required.');
      stage = 'role and grants';
      const count = await inspectStagingPermissions(client);
      await client.query('ROLLBACK');
      console.log(`Staging connection passed: verified TLS, restricted role, ${count} table grants.`);
      console.log('Read-only check; migration completeness, row isolation and providers are not verified.');
    } finally {
      // Destroy the connection, including any transaction left open by an error.
      client.release(true);
    }
  } catch {
    // Driver and filesystem errors may contain credentials or private paths.
    console.error(
      `Staging database check failed at ${stage}. Check endpoint, verify-full credentials and role grants.`,
    );
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
