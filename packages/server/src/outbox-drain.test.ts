import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { OutboxWorker } from './outbox';
import { OutboxDrain } from './outbox-drain';
let db: Awaited<ReturnType<typeof testDatabase>>;
let now: Date;
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE outbox');
  now = new Date('2026-09-07T12:00:00Z');
});
async function job(delay = 0) {
  await db.pool.query(
    "INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key,available_at) VALUES('fixture',$1,'{}',$2,$3)",
    [randomUUID(), randomUUID(), new Date(now.getTime() + delay)],
  );
}
function drain(handler = async () => {}) {
  return new OutboxDrain(
    db.pool,
    new OutboxWorker(
      db.pool,
      { fixture: handler },
      () => now,
      () => 0.5,
    ),
    () => now,
  );
}
test('drains only a bounded batch then requests another wakeup', async () => {
  for (let index = 0; index < 12; index++) await job();
  expect(await drain().run()).toEqual({ processed: 10, failed: 0, wakeAfterSeconds: 1 });
  expect(await drain().run()).toEqual({ processed: 2, failed: 0, wakeAfterSeconds: null });
});
test('delayed work and crashed-worker leases determine the next wakeup', async () => {
  await job(20000);
  expect(await drain().run()).toEqual({ processed: 0, failed: 0, wakeAfterSeconds: 20 });
  await db.pool.query('UPDATE outbox SET locked_until=$1,lease_token=$2', [
    new Date(now.getTime() + 60000),
    randomUUID(),
  ]);
  expect((await drain().run()).wakeAfterSeconds).toBe(60);
  now = new Date(now.getTime() + 60000);
  expect((await drain().run()).processed).toBe(1);
});
test('stops between slow jobs and schedules retry backoff rather than losing failed work', async () => {
  await job();
  await job();
  expect(
    await drain(async () => {
      now = new Date(now.getTime() + 21000);
    }).run(),
  ).toEqual({ processed: 1, failed: 0, wakeAfterSeconds: 1 });
  expect(
    await drain(async () => {
      throw new Error('provider unavailable');
    }).run(),
  ).toEqual({ processed: 0, failed: 1, wakeAfterSeconds: 2 });
});
