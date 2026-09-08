import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
export * from './schema';
export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
  });
  const connections = new Set<Promise<void>>();
  pool.on('connect', (client) => {
    const ended = new Promise<void>((resolve) => client.once('end', resolve));
    connections.add(ended);
    void ended.then(() => connections.delete(ended));
  });
  let closing: Promise<void> | undefined;
  return {
    pool,
    db: drizzle(pool, { schema, casing: 'snake_case' }),
    close: () =>
      (closing ??= (async () => {
        // pg-pool can resolve end() after removing idle clients but before their sockets close.
        await pool.end();
        await Promise.all(connections);
      })()),
  };
}
export type Database = ReturnType<typeof createDatabase>['db'];
