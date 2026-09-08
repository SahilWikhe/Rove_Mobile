import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { OutboxWorker } from './outbox';
let database: Awaited<ReturnType<typeof testDatabase>>;
let now: Date;
beforeAll(async () => {
  database = await testDatabase();
}, 60_000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE outbox CASCADE');
  now = new Date();
});
async function enqueue(topic = 'test', availableAt = now) {
  const id = randomUUID();
  await database.pool.query(
    'INSERT INTO outbox(id,topic,aggregate_id,payload,dedupe_key,available_at) VALUES($1,$2,$3,$4,$5,$6)',
    [id, topic, randomUUID(), '{}', id, availableAt],
  );
  return id;
}
test('competing workers lease each due event once', async () => {
  const seen: string[] = [];
  for (let i = 0; i < 10; i++) await enqueue();
  const handlers = {
    test: async (job: { id: string }) => {
      seen.push(job.id);
    },
  };
  await Promise.all([
    new OutboxWorker(database.pool, handlers).runOnce(),
    new OutboxWorker(database.pool, handlers).runOnce(),
  ]);
  expect(seen).toHaveLength(10);
  expect(new Set(seen).size).toBe(10);
  expect((await database.pool.query('SELECT id FROM outbox WHERE completed_at IS NOT NULL')).rowCount).toBe(
    10,
  );
});
test('failed jobs retry later without storing provider secrets in error text', async () => {
  const id = await enqueue();
  let calls = 0;
  const worker = new OutboxWorker(
    database.pool,
    {
      test: async () => {
        if (++calls === 1) throw new Error('secret-token-must-not-be-recorded');
      },
    },
    () => now,
    () => 0.5,
  );
  expect(await worker.runOnce()).toEqual({ processed: 0, failed: 1 });
  const row = (await database.pool.query('SELECT * FROM outbox WHERE id=$1', [id])).rows[0];
  expect(row.last_error_code).toBe('WORKER_ERROR');
  expect(JSON.stringify(row)).not.toContain('secret-token');
  await worker.runOnce();
  expect(calls).toBe(1);
  now = new Date(now.getTime() + 3000);
  await worker.runOnce();
  expect(calls).toBe(2);
  expect(
    (await database.pool.query('SELECT completed_at FROM outbox WHERE id=$1', [id])).rows[0].completed_at,
  ).not.toBeNull();
});
test('abandoned leases recover and unknown handlers become visible dead letters', async () => {
  const id = await enqueue('unknown');
  await database.pool.query(
    "UPDATE outbox SET locked_until=$2::timestamptz-interval '1 second',lease_token=$3 WHERE id=$1",
    [id, now, randomUUID()],
  );
  expect(await new OutboxWorker(database.pool, {}, () => now).runOnce()).toEqual({ processed: 0, failed: 1 });
  const row = (await database.pool.query('SELECT * FROM outbox WHERE id=$1', [id])).rows[0];
  expect(row.dead_letter_at).not.toBeNull();
  expect(row.last_error_code).toBe('UNKNOWN_JOB_TYPE');
});
test('scheduled jobs are not processed before their persisted deadline', async () => {
  await enqueue('test', new Date(now.getTime() + 20_000));
  let called = false;
  const worker = new OutboxWorker(
    database.pool,
    {
      test: async () => {
        called = true;
      },
    },
    () => now,
  );
  await worker.runOnce();
  expect(called).toBe(false);
  now = new Date(now.getTime() + 20_000);
  await worker.runOnce();
  expect(called).toBe(true);
});
