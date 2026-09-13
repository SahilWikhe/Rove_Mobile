import { Pool } from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { command, transaction } from './transactions';
import { bindCommandScope } from './command-scope';
import { bindActorIdentity } from './actor-transaction';
let db: Awaited<ReturnType<typeof testDatabase>>, runtime: Pool;
let actor: { id: string; role: 'rider' }, other: string;
const key = 'synthetic-command';
beforeAll(async () => {
  db = await testDatabase();
  await db.pool.query(
    "CREATE ROLE rls_command LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'synthetic-local-only'",
  );
  await db.pool.query('GRANT USAGE ON SCHEMA public TO rls_command');
  await db.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rls_command');
  await db.pool.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO rls_command');
  runtime = new Pool({
    host: '127.0.0.1',
    port: (await db.pool.query('SELECT inet_server_port() AS port')).rows[0].port,
    database: 'postgres',
    user: 'rls_command',
    password: 'synthetic-local-only',
    max: 5,
  });
}, 60000);
afterAll(async () => {
  await runtime?.end();
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  actor = { id: randomUUID(), role: 'rider' };
  other = randomUUID();
  for (const id of [actor.id, other])
    await db.pool.query(
      "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Synthetic actor','rider')",
      [id],
    );
});
test('concurrent command retries execute once and survive callback identity reset', async () => {
  let calls = 0;
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      command(runtime, actor.id, key, { action: 'synthetic' }, async (c) => {
        calls++;
        await bindActorIdentity(c, actor);
        return { id: 'synthetic-result' };
      }),
    ),
  );
  expect(calls).toBe(1);
  expect(results.every((r) => r.id === 'synthetic-result')).toBe(true);
  expect((await db.pool.query('SELECT * FROM commands')).rowCount).toBe(1);
  await expect(
    command(runtime, actor.id, key, { action: 'different' }, async () => ({})),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect((await runtime.query('SELECT * FROM commands')).rowCount).toBe(0);
});
test('command result access is actor/key specific and receipts cannot be changed', async () => {
  await command(runtime, actor.id, key, {}, async () => ({ private: 'first' }));
  await command(runtime, other, key, {}, async () => ({ private: 'second' }));
  await transaction(runtime, async (c) => {
    await bindCommandScope(c, actor.id, key);
    expect((await c.query('SELECT result FROM commands')).rows).toEqual([{ result: { private: 'first' } }]);
    expect((await c.query('DELETE FROM commands')).rowCount).toBe(0);
    expect((await c.query("UPDATE commands SET result='{}'")).rowCount).toBe(0);
    await bindCommandScope(c, actor.id, 'another-key');
    expect((await c.query('SELECT * FROM commands')).rowCount).toBe(0);
  });
  const fingerprint = createHash('sha256').update('{}').digest('hex');
  await expect(
    transaction(runtime, async (c) => {
      await bindCommandScope(c, actor.id, 'another-key', fingerprint);
      await c.query(
        "INSERT INTO commands(actor_id,key,fingerprint,result) VALUES($1,'another-key',$2,'{}')",
        [other, fingerprint],
      );
    }),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    transaction(runtime, async (c) => {
      await bindCommandScope(c, actor.id, 'another-key');
      await c.query(
        "INSERT INTO commands(actor_id,key,fingerprint,result) VALUES($1,'another-key',$2,'{}')",
        [actor.id, fingerprint],
      );
    }),
  ).rejects.toMatchObject({ code: '42501' });
  expect((await runtime.query('SELECT * FROM commands')).rowCount).toBe(0);
});
test('disabled accounts cannot replay committed commands or create new results', async () => {
  await command(runtime, actor.id, key, {}, async () => ({ id: 'private' }));
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [actor.id]);
  let calls = 0;
  for (const requestKey of [key, 'another-key'])
    await expect(
      command(runtime, actor.id, requestKey, {}, async () => {
        calls++;
        return {};
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
  expect(calls).toBe(0);
});
test('failed work rolls back mutations and can retry without a stale result', async () => {
  await expect(
    command(runtime, actor.id, key, {}, async (c) => {
      await c.query(
        "SELECT set_config('rove.user_profile_write',(to_jsonb(u)||jsonb_build_object('name','rollback fixture'))::text,true) FROM users u WHERE id=$1",
        [actor.id],
      );
      await c.query("UPDATE users SET name='rollback fixture' WHERE id=$1", [actor.id]);
      throw Error('synthetic failure');
    }),
  ).rejects.toThrow('synthetic failure');
  expect((await db.pool.query('SELECT * FROM commands')).rowCount).toBe(0);
  expect((await db.pool.query('SELECT name FROM users WHERE id=$1', [actor.id])).rows[0].name).toBe(
    'Synthetic actor',
  );
  expect(await command(runtime, actor.id, key, {}, async () => ({ ok: true }))).toEqual({ ok: true });
});

test('concurrent callbacks may lock the account without command-scope lock upgrades', async () => {
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      command(runtime, actor.id, 'synthetic-key-' + i, {}, async (c) => {
        await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
        return { index: i };
      }),
    ),
  );
  expect(results.map((r) => r.index).sort()).toEqual([0, 1, 2, 3]);
});
