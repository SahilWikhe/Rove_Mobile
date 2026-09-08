import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { stagingUrl } from './staging-config';

const pool = new Pool({ connectionString: stagingUrl(process.env, false), max: 1 });
try {
  const client = await pool.connect();
  try {
    // One direct session holds the lock throughout the versioned migration transaction.
    await client.query("SELECT pg_advisory_lock(hashtext('rove-schema-migrations'))");
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL('../migrations/', import.meta.url)),
    });
    console.log('Staging migrations applied. Re-running safely skips recorded migrations.');
  } finally {
    client.release(true);
  }
} catch {
  console.error('Staging migration failed; credentials and database error details withheld.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
