import { expect, test } from 'vitest';
import { testDatabase } from './testing';
import { inspectStagingPermissions } from './staging-readiness';

test('real PostgreSQL grants reject missing DML, elevated roles and sequence permissions', async () => {
  const database = await testDatabase();
  const client = await database.pool.connect();
  try {
    await client.query('CREATE ROLE rove_staging_app NOINHERIT');
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query('GRANT USAGE ON SCHEMA public TO rove_staging_app');
    await client.query(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rove_staging_app',
    );
    await client.query('CREATE SEQUENCE public.readiness_fixture');
    await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rove_staging_app');
    const inspect = async () => {
      await client.query('BEGIN READ ONLY');
      await client.query('SET LOCAL ROLE rove_staging_app');
      try {
        return await inspectStagingPermissions(client);
      } finally {
        await client.query('ROLLBACK');
      }
    };
    expect(await inspect()).toBeGreaterThan(0);
    // SELECT alone must not satisfy a comma-separated (OR) privilege check.
    await client.query('REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM rove_staging_app');
    await expect(inspect()).rejects.toThrow('table');
    await client.query('GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rove_staging_app');
    await client.query('GRANT TRUNCATE ON ALL TABLES IN SCHEMA public TO rove_staging_app');
    await expect(inspect()).rejects.toThrow('table');
    await client.query('REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM rove_staging_app');
    await client.query('REVOKE USAGE ON SEQUENCE public.readiness_fixture FROM rove_staging_app');
    await expect(inspect()).rejects.toThrow('sequence');
    await client.query('GRANT USAGE ON SEQUENCE public.readiness_fixture TO rove_staging_app');
    await client.query('ALTER ROLE rove_staging_app CREATEDB');
    await expect(inspect()).rejects.toThrow('role');
    await client.query('ALTER ROLE rove_staging_app NOCREATEDB');
    await client.query('CREATE ROLE privileged_fixture');
    await client.query('GRANT privileged_fixture TO rove_staging_app');
    await expect(inspect()).rejects.toThrow('role');
    await client.query('REVOKE privileged_fixture FROM rove_staging_app');
    expect(await inspect()).toBeGreaterThan(0);
  } finally {
    client.release(true);
    await database.close();
  }
}, 60_000);
