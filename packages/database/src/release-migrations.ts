import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PoolClient } from 'pg';

export type Migration = { tag: string; when: number; hash: string; sql: string };
export type Target = { host: string; database: string; migrationRole: string; runtimeRole: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function releaseTarget(env: Record<string, string | undefined>) {
  const fail = () => new Error('Invalid production migration target.');
  const target: Target = {
    host: env.PRODUCTION_DATABASE_HOST ?? '',
    database: env.PRODUCTION_DATABASE_NAME ?? '',
    migrationRole: env.PRODUCTION_MIGRATION_ROLE ?? '',
    runtimeRole: env.PRODUCTION_RUNTIME_ROLE ?? '',
  };
  let url: URL;
  try {
    url = new URL(env.PRODUCTION_MIGRATION_DATABASE_URL ?? '');
  } catch {
    throw fail();
  }
  if (
    env.ROVE_ENVIRONMENT !== 'production' ||
    env.VERCEL ||
    !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(target.host) ||
    target.host.includes('-pooler.') ||
    ![target.database, target.migrationRole, target.runtimeRole].every((v) =>
      /^[a-z][a-z0-9_]{0,62}$/.test(v),
    ) ||
    target.migrationRole === target.runtimeRole ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== target.host ||
    decodeURIComponent(url.pathname.slice(1)) !== target.database ||
    decodeURIComponent(url.username) !== target.migrationRole ||
    !url.password ||
    url.port ||
    url.hash ||
    url.search !== '?sslmode=verify-full'
  )
    throw fail();
  return { target, connectionString: url.toString() };
}
export function loadReleaseMigrations(folder: string): Migration[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  if (!Array.isArray(journal.entries) || !journal.entries.length)
    throw new Error('Missing migration history.');
  const tags = new Set<string>();
  return journal.entries.map((entry, i) => {
    if (
      entry.idx !== i ||
      !/^\d{4}_[a-z0-9_]+$/.test(entry.tag) ||
      tags.has(entry.tag) ||
      !Number.isSafeInteger(entry.when) ||
      entry.when <= 0 ||
      journal.entries.slice(0, i).some((previous) => previous.when === entry.when)
    )
      throw new Error('Invalid migration history.');
    tags.add(entry.tag);
    const sql = readFileSync(join(folder, entry.tag + '.sql'), 'utf8');
    if (!sql.trim()) throw new Error('Empty migration.');
    return { tag: entry.tag, when: entry.when, hash: digest(sql), sql };
  });
}

/** One direct session and transaction: validate the full prefix before executing any DDL. */
export async function releaseMigrations(
  client: PoolClient,
  target: Target,
  migrations: Migration[],
  approvedPlan?: string,
) {
  await client.query(approvedPlan ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='60s'");
    const lock = await client.query(
      "SELECT pg_try_advisory_xact_lock(hashtext('rove-schema-migrations')) AS locked",
    );
    if (!lock.rows[0].locked) throw new Error('Another migration is running.');
    const identity = await client.query('SELECT current_database() AS database,current_user AS role');
    if (identity.rows[0].database !== target.database || identity.rows[0].role !== target.migrationRole)
      throw new Error('Connected database identity mismatch.');
    const role = await client.query('SELECT rolname,rolsuper FROM pg_roles WHERE rolname=$1', [
      target.runtimeRole,
    ]);
    if (!role.rowCount || role.rows[0].rolsuper) throw new Error('Restricted runtime role must exist.');
    const membership = await client.query("SELECT pg_has_role($1,$2,'MEMBER') AS inherited", [
      target.runtimeRole,
      target.migrationRole,
    ]);
    if (membership.rows[0].inherited) throw new Error('Runtime role inherits migration permissions.');
    const exists = await client.query(
      "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present",
    );
    let applied: { hash: string; created_at: string }[] = [];
    if (exists.rows[0].present) {
      applied = (await client.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id'))
        .rows;
    } else {
      const tables = await client.query(
        "SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') LIMIT 1",
      );
      if (tables.rowCount) throw new Error('Nonempty database has no migration journal.');
    }
    if (
      applied.length > migrations.length ||
      applied.some(
        (row, i) => row.hash !== migrations[i]?.hash || Number(row.created_at) !== migrations[i]?.when,
      )
    )
      throw new Error('Database migration history diverges from this release.');
    const pending = migrations.slice(applied.length);
    const plan = {
      target,
      applied: applied.length,
      pending: pending.map(({ tag, hash, when }) => ({ tag, hash, when })),
    };
    const planHash = digest(
      JSON.stringify({
        target,
        migrations: migrations.map(({ tag, hash, when }) => ({ tag, hash, when })),
        applied,
      }),
    );
    if (approvedPlan) {
      if (approvedPlan !== planHash) throw new Error('Plan changed; review a fresh plan before applying.');
      await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
      await client.query(
        'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
      );
      for (const migration of pending) {
        for (const sql of migration.sql.split('--> statement-breakpoint'))
          if (sql.trim()) await client.query(sql);
        await client.query('INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)', [
          migration.hash,
          migration.when,
        ]);
      }
    }
    await client.query('COMMIT');
    return { ...plan, planHash, appliedNow: approvedPlan ? pending.length : 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
