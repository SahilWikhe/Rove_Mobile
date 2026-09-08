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
  return { pool, db: drizzle(pool, { schema, casing: 'snake_case' }) };
}
export type Database = ReturnType<typeof createDatabase>['db'];
