import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDatabase } from '../packages/database/src/testing.ts';
import { createDatabase } from '../packages/database/src/index.ts';

// No URL argument or environment database is accepted. Both databases belong to this new local server.
const bin = process.env.ROVE_PG_CLIENT_BIN;
let failed = false;
let result;
let stage = 'client tools';
let source;
let restored;
let runtime;
let directory;
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
function client(tool, args, connectionString) {
  const url = new URL(connectionString);
  assert.equal(url.hostname, '127.0.0.1');
  assert.ok(['postgres', 'rove_restore_rehearsal', 'rove_restore_schema'].includes(url.pathname.slice(1)));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
  return execFileSync(join(bin, tool), args, {
    env: {
      ...env,
      PGHOST: '127.0.0.1',
      PGPORT: url.port,
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.slice(1),
      PGCONNECT_TIMEOUT: '10',
      PGSSLMODE: 'disable',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}
async function records(pool) {
  const tables = (
    await pool.query(`SELECT schemaname,tablename FROM pg_tables
    WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename`)
  ).rows;
  const result = [];
  for (const table of tables) {
    const name = `${quote(table.schemaname)}.${quote(table.tablename)}`;
    const rows = (await pool.query(`SELECT to_jsonb(t) AS value FROM ${name} t ORDER BY to_jsonb(t)::text`))
      .rows;
    result.push({ ...table, rows });
  }
  return result;
}
function schema(url) {
  // pg_dump generates a fresh psql restriction nonce each invocation, not schema content.
  return client('pg_dump', ['--schema-only'], url).replace(/^\\(?:un)?restrict .*$/gm, '');
}
try {
  assert.equal(process.argv.length, 2, 'No database targets or other arguments are accepted.');
  assert.ok(bin, 'Set ROVE_PG_CLIENT_BIN to the PostgreSQL client binary directory.');
  for (const tool of ['pg_dump', 'pg_restore', 'psql']) {
    const version = execFileSync(join(bin, tool), ['--version'], { encoding: 'utf8', timeout: 10_000 });
    assert.match(version, /PostgreSQL\) 18\./);
  }
  stage = 'isolated source and migrations';
  source = await testDatabase();
  directory = await mkdtemp(join(tmpdir(), 'rove-restore-rehearsal-'));
  const archive = join(directory, 'synthetic.dump');
  const rider = randomUUID();
  const driver = randomUUID();
  const later = randomUUID();
  await source.pool.query(
    `INSERT INTO users(id,subject,name,role) VALUES
    ($1,'restore|rider','Before backup rider','rider'),($2,'restore|driver','Before backup driver','driver')`,
    [rider, driver],
  );
  const password = randomBytes(32).toString('hex');
  await source.pool.query(`CREATE ROLE rove_restore_runtime LOGIN PASSWORD '${password}'
    NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
    GRANT USAGE ON SCHEMA public TO rove_restore_runtime;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rove_restore_runtime`);
  const before = await records(source.pool);
  const beforeSchema = schema(source.connectionString);
  stage = 'dump';
  client('pg_dump', ['--format=custom', '--file', archive], source.connectionString);
  // Deliberately create divergence after the completed backup.
  await source.pool.query(`UPDATE users SET name='Changed after backup' WHERE id=$1`, [rider]);
  await source.pool.query(
    `INSERT INTO users(id,subject,name,role) VALUES($1,'restore|later','After backup','rider')`,
    [later],
  );
  assert.notDeepEqual(await records(source.pool), before);
  await source.pool.query('CREATE DATABASE rove_restore_rehearsal TEMPLATE template0');
  const target = new URL(source.connectionString);
  target.pathname = '/rove_restore_rehearsal';
  stage = 'restore';
  const started = performance.now();
  client(
    'pg_restore',
    ['--exit-on-error', '--single-transaction', '--dbname', 'rove_restore_rehearsal', archive],
    target.toString(),
  );
  const restoreMilliseconds = Math.round(performance.now() - started);
  restored = createDatabase(target.toString());
  stage = 'schema, policies, grants and restored data';
  // PostgreSQL flattens redundant boolean groups when parsing its own dumped SQL.
  // Parse the independent plain schema dump into an empty baseline, then compare
  // its canonical dump (including grants and policies) with the custom-archive restore.
  await source.pool.query('CREATE DATABASE rove_restore_schema TEMPLATE template0');
  const baseline = new URL(source.connectionString);
  baseline.pathname = '/rove_restore_schema';
  const schemaFile = join(directory, 'synthetic-schema.sql');
  await writeFile(schemaFile, beforeSchema, { mode: 0o600 });
  client(
    'psql',
    ['-X', '--set', 'ON_ERROR_STOP=1', '--single-transaction', '--file', schemaFile],
    baseline.toString(),
  );
  assert.equal(schema(target.toString()), schema(baseline.toString()));
  stage = 'restored records';
  assert.deepEqual(await records(restored.pool), before);
  const security = (
    await restored.pool.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
    pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`)
  ).rows;
  assert.ok(security.length > 0);
  assert.ok(
    security.every(
      (row) => row.relrowsecurity && row.relforcerowsecurity && row.owner !== 'rove_restore_runtime',
    ),
  );
  const migrationCount = (
    await restored.pool.query('SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations')
  ).rows[0].count;
  target.username = 'rove_restore_runtime';
  target.password = password;
  runtime = createDatabase(target.toString());
  stage = 'restricted runtime access';
  const role = (
    await runtime.pool.query(`SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolinherit
    FROM pg_roles WHERE rolname=current_user`)
  ).rows[0];
  assert.ok(Object.values(role).every((value) => value === false));
  assert.equal((await runtime.pool.query('SELECT id FROM users')).rowCount, 0);
  const c = await runtime.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('rove.actor_id',$1,true),set_config('rove.actor_role','rider',true)", [
      rider,
    ]);
    assert.deepEqual((await c.query('SELECT id,name FROM users ORDER BY id')).rows, [
      { id: rider, name: 'Before backup rider' },
    ]);
    assert.equal((await c.query('SELECT id FROM users WHERE id=$1', [driver])).rowCount, 0);
    assert.equal((await c.query("UPDATE users SET name='Unauthorized' WHERE id=$1", [driver])).rowCount, 0);
    await c.query('ROLLBACK');
  } finally {
    c.release();
  }
  assert.equal((await runtime.pool.query('SELECT id FROM users')).rowCount, 0);
  result = {
    localSyntheticRestoreVerified: true,
    applicationTables: security.length,
    migrations: migrationCount,
    restoreMilliseconds,
    schemaAndDataMatch: true,
    restrictedAccessVerified: true,
    hostedRestoreVerified: false,
    externalProviderReconciliationVerified: false,
  };
} catch {
  console.error(
    `Local synthetic restore rehearsal failed during ${stage}. Diagnostic contents withheld; no hosted database was selected.`,
  );
  failed = true;
} finally {
  for (const close of [
    () => runtime?.close(),
    () => restored?.close(),
    () => source?.close(),
    () => directory && rm(directory, { recursive: true, force: true }),
  ]) {
    try {
      await close();
    } catch {
      failed = true;
      console.error('Synthetic rehearsal cleanup failed; inspect local resources before retrying.');
    }
  }
}
if (!failed) console.log(JSON.stringify(result));
// The embedded server installs an exit hook; pass the verified result explicitly.
process.exit(failed ? 1 : 0);
