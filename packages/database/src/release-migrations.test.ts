import { afterAll, beforeAll, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { testDatabase } from './testing';
import {
  loadReleaseMigrations,
  releaseMigrations,
  releaseTarget,
  type Migration,
} from './release-migrations';
let db: Awaited<ReturnType<typeof testDatabase>>;
const runtimeRole = 'release_runtime';
const migrations = loadReleaseMigrations(fileURLToPath(new URL('../migrations/', import.meta.url)));
beforeAll(async () => {
  db = await testDatabase();
  await db.pool.query(`CREATE ROLE ${runtimeRole} NOLOGIN`);
}, 60000);
afterAll(async () => {
  await db?.close();
});
async function isolated() {
  const name = 'release_' + randomUUID().replaceAll('-', '');
  await db.pool.query(`CREATE DATABASE ${name}`);
  const connection = new URL(db.pool.options.connectionString!);
  connection.pathname = '/' + name;
  const pool = new Pool({ connectionString: connection.toString() });
  const client = await pool.connect();
  return {
    client,
    target: { host: 'local-test', database: name, migrationRole: 'rove_test', runtimeRole },
    close: async () => {
      client.release(true);
      await pool.end();
    },
  };
}
const extra = (sql: string): Migration => ({
  tag: '0029_test',
  when: migrations.at(-1)!.when + 1,
  hash: createHash('sha256').update(sql).digest('hex'),
  sql,
});
test('read-only plan, complete fresh migration, idempotent rerun and stale-plan rejection', async () => {
  const f = await isolated();
  try {
    const plan = await releaseMigrations(f.client, f.target, migrations);
    expect(plan.pending).toHaveLength(migrations.length);
    expect(
      (await f.client.query("SELECT to_regclass('public.users') AS relation")).rows[0].relation,
    ).toBeNull();
    expect((await releaseMigrations(f.client, f.target, migrations, plan.planHash)).appliedNow).toBe(
      migrations.length,
    );
    expect(
      (
        await f.client.query(
          "SELECT count(*)::int AS count FROM pg_trigger WHERE tgfoid=to_regprocedure('public.rove_notify_messages()')",
        )
      ).rows[0].count,
    ).toBe(6);
    await expect(releaseMigrations(f.client, f.target, migrations, plan.planHash)).rejects.toThrow(
      'Plan changed',
    );
    const current = await releaseMigrations(f.client, f.target, migrations);
    expect(current.pending).toEqual([]);
    expect((await releaseMigrations(f.client, f.target, migrations, current.planHash)).appliedNow).toBe(0);
    await f.client.query("UPDATE drizzle.__drizzle_migrations SET hash='tampered' WHERE id=1");
    await expect(releaseMigrations(f.client, f.target, migrations)).rejects.toThrow('diverges');
  } finally {
    await f.close();
  }
}, 60000);
test('DDL failure rolls back every pending statement and its migration journal', async () => {
  const f = await isolated();
  try {
    const broken = [
      ...migrations,
      extra('CREATE TABLE release_partial(id int); SELECT missing_release_function();'),
    ];
    const p = await releaseMigrations(f.client, f.target, broken);
    await expect(releaseMigrations(f.client, f.target, broken, p.planHash)).rejects.toThrow();
    expect(
      (
        await f.client.query(
          "SELECT to_regclass('public.users') AS users,to_regclass('public.release_partial') AS partial,to_regclass('drizzle.__drizzle_migrations') AS journal",
        )
      ).rows[0],
    ).toEqual({ users: null, partial: null, journal: null });
  } finally {
    await f.close();
  }
}, 60000);
test('refuses a concurrent migration, wrong identity, inherited owner role and unjournaled tables', async () => {
  const f = await isolated();
  const other = await db.pool.connect();
  try {
    // Advisory locks are database-scoped; use another connection to the same target.
    const connection = new URL(db.pool.options.connectionString!);
    connection.pathname = '/' + f.target.database;
    const competingPool = new Pool({ connectionString: connection.toString() });
    const competing = await competingPool.connect();
    try {
      await competing.query("SELECT pg_advisory_lock(hashtext('rove-schema-migrations'))");
      await expect(releaseMigrations(f.client, f.target, migrations)).rejects.toThrow('Another migration');
    } finally {
      try {
        // Closing a socket does not wait for PostgreSQL to release session locks.
        // Await the unlock so subsequent identity checks cannot race backend cleanup.
        const unlocked = await competing.query(
          "SELECT pg_advisory_unlock(hashtext('rove-schema-migrations')) AS unlocked",
        );
        expect(unlocked.rows[0].unlocked).toBe(true);
      } finally {
        competing.release(true);
        await competingPool.end();
      }
    }
    await expect(releaseMigrations(f.client, { ...f.target, database: 'wrong' }, migrations)).rejects.toThrow(
      'identity mismatch',
    );
    await other.query(`GRANT rove_test TO ${runtimeRole}`);
    try {
      await expect(releaseMigrations(f.client, f.target, migrations)).rejects.toThrow('inherits');
    } finally {
      await other.query(`REVOKE rove_test FROM ${runtimeRole}`);
    }
    await f.client.query('CREATE TABLE unrelated(id int)');
    await expect(releaseMigrations(f.client, f.target, migrations)).rejects.toThrow('Nonempty database');
  } finally {
    other.release();
    await f.close();
  }
});
test('configuration rejects pooled URLs, insecure TLS, wrong roles and missing explicit target', () => {
  const env = {
    ROVE_ENVIRONMENT: 'production',
    PRODUCTION_DATABASE_HOST: 'ep-example.us-east-2.aws.neon.tech',
    PRODUCTION_DATABASE_NAME: 'neondb',
    PRODUCTION_MIGRATION_ROLE: 'owner',
    PRODUCTION_RUNTIME_ROLE: 'app',
    PRODUCTION_MIGRATION_DATABASE_URL:
      'postgresql://owner:secret@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=verify-full',
  };
  expect(releaseTarget(env).target.runtimeRole).toBe('app');
  for (const change of [
    { ROVE_ENVIRONMENT: 'staging' },
    { PRODUCTION_RUNTIME_ROLE: 'owner' },
    { PRODUCTION_DATABASE_HOST: '' },
    { VERCEL: '1' },
    {
      PRODUCTION_MIGRATION_DATABASE_URL: env.PRODUCTION_MIGRATION_DATABASE_URL.replace(
        'ep-example.',
        'ep-example-pooler.',
      ),
    },
    {
      PRODUCTION_MIGRATION_DATABASE_URL: env.PRODUCTION_MIGRATION_DATABASE_URL.replace(
        'verify-full',
        'require',
      ),
    },
  ])
    expect(() => releaseTarget({ ...env, ...change })).toThrow('Invalid production');
});
