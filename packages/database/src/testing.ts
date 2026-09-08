import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './index';

/** Test-only real PostgreSQL. Never connects to an environment-provided database. */
export async function testDatabase() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  const postgres = new EmbeddedPostgres({
    databaseDir: await mkdtemp(join(tmpdir(), 'rove-postgres-')),
    port,
    user: 'rove_test',
    password: 'local-fixture-only',
    persistent: false,
  });
  await postgres.initialise();
  await postgres.start();
  const database = createDatabase(`postgresql://rove_test:local-fixture-only@127.0.0.1:${port}/postgres`);
  try {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../migrations/', import.meta.url)),
    });
  } catch (error) {
    await database.close();
    await postgres.stop();
    throw error;
  }
  return {
    ...database,
    close: async () => {
      await database.close();
      await postgres.stop();
    },
  };
}
