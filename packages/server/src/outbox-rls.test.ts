import { randomUUID, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createDatabase } from '@rove/database';
import { testDatabase } from '@rove/database/testing';
import { OutboxWorker } from './outbox';
import { OutboxDrain } from './outbox-drain';
import { outboxTransaction } from './outbox-scope';
let db: Awaited<ReturnType<typeof testDatabase>>;
let runtime: ReturnType<typeof createDatabase>;
let now: Date;
beforeAll(async () => {
  db = await testDatabase();
  const password = randomBytes(32).toString('hex');
  await db.pool.query(`CREATE ROLE outbox_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
  await db.pool.query('GRANT USAGE ON SCHEMA public TO outbox_runtime');
  await db.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO outbox_runtime');
  const connection = new URL(db.connectionString);
  connection.username = 'outbox_runtime';
  connection.password = password;
  runtime = createDatabase(connection.toString());
}, 60000);
afterAll(async () => {
  await runtime?.close();
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE outbox CASCADE');
  now = new Date();
});
async function seed(at = now) {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO outbox(id,topic,aggregate_id,payload,dedupe_key,available_at) VALUES($1::uuid,'synthetic',$2,'{}',$1::text,$3)",
    [id, randomUUID(), at],
  );
  return id;
}
test('restricted competing workers claim each due job once and acknowledge their leases', async () => {
  for (let i = 0; i < 8; i++) await seed();
  const future = await seed(new Date(now.getTime() + 60000));
  const seen: string[] = [];
  const handler = async (job: { id: string }) => {
    seen.push(job.id);
  };
  await Promise.all([
    new OutboxWorker(runtime.pool, { synthetic: handler }, () => now).runOnce(),
    new OutboxWorker(runtime.pool, { synthetic: handler }, () => now).runOnce(),
  ]);
  expect(seen).toHaveLength(8);
  expect(new Set(seen).size).toBe(8);
  expect(seen).not.toContain(future);
  expect((await db.pool.query('SELECT id FROM outbox WHERE completed_at IS NOT NULL')).rowCount).toBe(8);
  expect((await runtime.pool.query('SELECT * FROM outbox')).rowCount).toBe(0);
  expect((await runtime.pool.query('DELETE FROM outbox')).rowCount).toBe(0);
});
test('restricted workers retry failures and drain schedules the next wakeup', async () => {
  await seed();
  let calls = 0;
  const worker = new OutboxWorker(
    runtime.pool,
    {
      synthetic: async () => {
        if (++calls === 1) throw Error('synthetic secret');
      },
    },
    () => now,
    () => 0.5,
  );
  const drain = new OutboxDrain(runtime.pool, worker, () => now);
  expect(await drain.run()).toEqual({ processed: 0, failed: 1, wakeAfterSeconds: 2 });
  expect((await db.pool.query('SELECT last_error_code FROM outbox')).rows[0].last_error_code).toBe(
    'WORKER_ERROR',
  );
  now = new Date(now.getTime() + 2001);
  expect(await drain.run()).toEqual({ processed: 1, failed: 0, wakeAfterSeconds: null });
});
test('notification and queue scopes are read-only; a foreign lease cannot acknowledge work', async () => {
  const id = await seed(),
    other = await seed(),
    token = randomUUID();
  await db.pool.query(
    "UPDATE outbox SET lease_token=$2,locked_until=$3::timestamptz+interval '60 seconds' WHERE id=$1",
    [id, token, now],
  );
  await outboxTransaction(runtime.pool, { kind: 'notification', id }, async (c) => {
    expect((await c.query('SELECT id FROM outbox')).rows).toEqual([{ id }]);
    expect((await c.query('UPDATE outbox SET completed_at=now()')).rowCount).toBe(0);
  });
  await outboxTransaction(runtime.pool, { kind: 'queue' }, async (c) => {
    expect((await c.query('SELECT id FROM outbox')).rowCount).toBe(2);
    expect((await c.query('UPDATE outbox SET completed_at=now()')).rowCount).toBe(0);
  });
  await outboxTransaction(runtime.pool, { kind: 'ack', id, token: randomUUID() }, async (c) => {
    expect(
      (
        await c.query('UPDATE outbox SET completed_at=now(),lease_token=NULL,locked_until=NULL WHERE id=$1', [
          id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  await outboxTransaction(runtime.pool, { kind: 'ack', id, token }, async (c) => {
    expect(
      (
        await c.query('UPDATE outbox SET completed_at=now(),lease_token=NULL,locked_until=NULL WHERE id=$1', [
          other,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await c.query('UPDATE outbox SET completed_at=now(),lease_token=NULL,locked_until=NULL WHERE id=$1', [
          id,
        ])
      ).rowCount,
    ).toBe(1);
  });
  expect((await runtime.pool.query('SELECT * FROM outbox')).rowCount).toBe(0);
});
test('expired leases recover and unknown topics become dead letters', async () => {
  const id = await seed();
  await db.pool.query(
    "UPDATE outbox SET lease_token=$2,locked_until=$3::timestamptz-interval '1 second' WHERE id=$1",
    [id, randomUUID(), now],
  );
  expect(await new OutboxWorker(runtime.pool, {}, () => now).runOnce()).toEqual({ processed: 0, failed: 1 });
  const row = (await db.pool.query('SELECT * FROM outbox WHERE id=$1', [id])).rows[0];
  expect(row.dead_letter_at).not.toBeNull();
  expect(row.last_error_code).toBe('UNKNOWN_JOB_TYPE');
  expect(
    await new OutboxDrain(runtime.pool, new OutboxWorker(runtime.pool, {}, () => now), () => now).run(),
  ).toEqual({ processed: 0, failed: 0, wakeAfterSeconds: null });
});
