import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { createDatabase } from '@rove/database';
import { testDatabase } from '@rove/database/testing';
import { appendAudit } from './audit';
import { transaction } from './transactions';
let db: Awaited<ReturnType<typeof testDatabase>>;
let runtime: ReturnType<typeof createDatabase>;
let actor: string;
beforeAll(async () => {
  db = await testDatabase();
  const password = randomBytes(32).toString('hex');
  await db.pool.query(`CREATE ROLE rls_audit LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
  await db.pool.query('GRANT USAGE ON SCHEMA public TO rls_audit');
  await db.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rls_audit');
  const connection = new URL(db.connectionString);
  connection.username = 'rls_audit';
  connection.password = password;
  runtime = createDatabase(connection.toString());
}, 60000);
afterAll(async () => {
  await runtime?.close();
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  actor = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Synthetic','rider')",
    [actor],
  );
});
test('runtime appends actor and worker events but cannot read, change or delete history', async () => {
  const aggregate = randomUUID();
  await transaction(runtime.pool, async (c) => {
    await appendAudit(c, actor, 'synthetic.actor', aggregate, '{"version":1}');
    await appendAudit(c, null, 'synthetic.worker', aggregate, '{}');
    expect((await c.query('SELECT * FROM audit')).rowCount).toBe(0);
    expect((await c.query("UPDATE audit SET metadata='{}'")).rowCount).toBe(0);
    expect((await c.query('DELETE FROM audit')).rowCount).toBe(0);
    expect((await c.query("SELECT current_setting('rove.audit_append',true) AS scope")).rows[0].scope).toBe(
      '',
    );
  });
  expect((await db.pool.query('SELECT action,actor_id,metadata FROM audit ORDER BY action')).rows).toEqual([
    { action: 'synthetic.actor', actor_id: actor, metadata: { version: 1 } },
    { action: 'synthetic.worker', actor_id: null, metadata: {} },
  ]);
  expect(
    (
      await db.pool.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='audit'::regclass",
      )
    ).rows[0],
  ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
});
test('unscoped insert and changed scoped fields are rejected', async () => {
  const id = randomUUID(),
    aggregate = randomUUID();
  const record = { id, actor, action: 'synthetic', aggregate, metadata: { version: 1 } };
  const insert = 'INSERT INTO audit(id,actor_id,action,aggregate_id,metadata) VALUES($1,$2,$3,$4,$5)';
  await expect(
    transaction(runtime.pool, (c) => c.query(insert, [id, actor, 'synthetic', aggregate, '{}'])),
  ).rejects.toMatchObject({ code: '42501' });
  for (const change of [
    { id: randomUUID() },
    { actor: null },
    { action: 'forged' },
    { aggregate: randomUUID() },
    { metadata: { version: 2 } },
  ]) {
    const altered = { ...record, ...change };
    await expect(
      transaction(runtime.pool, async (c) => {
        await c.query("SELECT set_config('rove.audit_append',$1,true)", [JSON.stringify(record)]);
        await c.query(insert, [
          altered.id,
          altered.actor,
          altered.action,
          altered.aggregate,
          JSON.stringify(altered.metadata),
        ]);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  }
  expect((await db.pool.query('SELECT * FROM audit')).rowCount).toBe(0);
});
test('rollback removes audit and domain changes and scope does not survive transaction end', async () => {
  await expect(
    transaction(runtime.pool, async (c) => {
      await c.query("UPDATE users SET name='Changed' WHERE id=$1", [actor]);
      await appendAudit(c, actor, 'synthetic', randomUUID(), '{}');
      throw new Error('synthetic rollback');
    }),
  ).rejects.toThrow('synthetic rollback');
  expect((await db.pool.query('SELECT name FROM users WHERE id=$1', [actor])).rows[0].name).toBe('Synthetic');
  expect((await db.pool.query('SELECT * FROM audit')).rowCount).toBe(0);
  await expect(
    transaction(runtime.pool, (c) =>
      c.query("INSERT INTO audit(action,aggregate_id,metadata) VALUES('synthetic',$1,'{}')", [randomUUID()]),
    ),
  ).rejects.toMatchObject({ code: '42501' });
});
