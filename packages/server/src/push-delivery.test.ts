import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { PushDelivery } from './push-delivery';
import { OutboxWorker, type Job } from './outbox';
import type { PushTicket, PushReceipt } from './push-provider';
let db: Awaited<ReturnType<typeof testDatabase>>;
let now: Date, eventId: string, installation: string, owner: string;
const projects = { rider: randomUUID(), driver: randomUUID() };
const provider = {
  send: vi.fn<(...args: unknown[]) => Promise<PushTicket>>(),
  receipt: vi.fn<(_id: string) => Promise<PushReceipt>>(),
};
let service: PushDelivery;
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  await db.pool.query('TRUNCATE outbox CASCADE');
  await db.pool.query('TRUNCATE push_rate_windows');
  now = new Date(Date.now() + 1000);
  owner = randomUUID();
  eventId = randomUUID();
  installation = randomUUID();
  provider.send.mockReset().mockResolvedValue({ status: 'accepted', receiptId: randomUUID() });
  provider.receipt.mockReset().mockResolvedValue({ status: 'accepted_by_gateway' });
  await db.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Synthetic','rider')",
    [owner],
  );
  const quote = randomUUID(),
    ride = randomUUID();
  await db.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',$3)", [
    quote,
    owner,
    now,
  ]);
  await db.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,'matched',1000,750,$4)",
    [ride, quote, owner, now],
  );
  await db.pool.query(
    `INSERT INTO push_installations(id,project_id,installation_id,secret_hash,owner_id,token,platform)
    VALUES($1,$2,$3,'unused-fixture-hash',$4,'ExpoPushToken[synthetic]','ios')`,
    [installation, projects.rider, randomUUID(), owner],
  );
  await db.pool.query(
    `INSERT INTO outbox(id,topic,aggregate_id,payload,dedupe_key,created_at,available_at)
    VALUES($1::uuid,'ride.matched',$2,'{}',$1::text,$3,$3)`,
    [eventId, ride, now],
  );
  service = new PushDelivery(db.pool, provider, projects, () => now);
});
async function job(topic: string): Promise<Job> {
  const row = (
    await db.pool.query(
      "SELECT * FROM outbox WHERE topic=$1 ORDER BY available_at DESC,(payload->>'attempt')::int DESC NULLS LAST,id LIMIT 1",
      [topic],
    )
  ).rows[0];
  return { id: row.id, topic, aggregateId: row.aggregate_id, payload: row.payload, attempt: 1 };
}
async function state() {
  return (await db.pool.query('SELECT * FROM push_deliveries')).rows[0];
}
async function prepared() {
  await service.fanout(await job('ride.matched'));
  return job('push.send');
}

test('real outbox drain fans out once and preserves existing handlers; gateway receipt is distinct from send acceptance', async () => {
  const previous = vi.fn(async () => {});
  const worker = new OutboxWorker(db.pool, service.handlers({ 'ride.matched': previous }), () => now);
  expect(await worker.runOnce()).toEqual({ processed: 2, failed: 0 });
  expect(previous).toHaveBeenCalledOnce();
  expect(provider.send).toHaveBeenCalledOnce();
  expect((await state()).state).toBe('receipt');
  await service.fanout(await job('ride.matched'));
  expect((await db.pool.query('SELECT * FROM push_deliveries')).rowCount).toBe(1);
  expect((await db.pool.query("SELECT * FROM outbox WHERE topic='push.send'")).rowCount).toBe(1);
  await service.send(await job('push.send'));
  expect(provider.send).toHaveBeenCalledOnce();
  expect(await worker.runOnce()).toEqual({ processed: 0, failed: 0 });
  now = new Date(now.getTime() + 900000);
  expect(await worker.runOnce()).toEqual({ processed: 1, failed: 0 });
  expect((await state()).state).toBe('accepted_by_gateway');
});
test('revocation between fan-out and send suppresses transport', async () => {
  const send = await prepared();
  await db.pool.query('UPDATE push_installations SET enabled=false,revision=revision+1');
  await service.send(send);
  expect((await state()).state).toBe('suppressed');
  expect(provider.send).not.toHaveBeenCalled();
});
test('unconfirmed sends retain safe retry state and stop retrying after event expiry', async () => {
  const send = await prepared();
  provider.send.mockRejectedValueOnce(new Error('sensitive provider body'));
  await expect(service.send(send)).rejects.toMatchObject({ code: 'PUSH_SEND_RETRY' });
  expect(await state()).toMatchObject({
    state: 'pending',
    last_error: 'PUSH_SEND_UNCONFIRMED',
    lease_token: null,
  });
  expect(JSON.stringify(await state())).not.toContain('sensitive');
  now = new Date(now.getTime() + 300000);
  await service.send(send);
  expect((await state()).state).toBe('suppressed');
  expect(provider.send).toHaveBeenCalledTimes(1);
});
test('simultaneous delivery invocations cannot both send while the domain lease is live', async () => {
  const send = await prepared();
  let finish!: (value: PushTicket) => void;
  const started = new Promise<void>((resolve) => {
    provider.send.mockImplementationOnce(() => {
      resolve();
      return new Promise((r) => {
        finish = r;
      });
    });
  });
  const first = service.send(send);
  await started;
  await expect(service.send(send)).rejects.toMatchObject({ code: 'PUSH_DELIVERY_BUSY' });
  finish({ status: 'accepted', receiptId: randomUUID() });
  await first;
  expect(provider.send).toHaveBeenCalledTimes(1);
});
test('a lost lease fences late transport results instead of overwriting a newer accepted attempt', async () => {
  const send = await prepared();
  let finish!: (value: PushTicket) => void;
  const started = new Promise<void>((resolve) => {
    provider.send.mockImplementationOnce(() => {
      resolve();
      return new Promise((r) => {
        finish = r;
      });
    });
  });
  const first = service.send(send);
  await started;
  now = new Date(now.getTime() + 61000);
  const fresh = randomUUID();
  provider.send.mockResolvedValueOnce({ status: 'accepted', receiptId: fresh });
  await service.send(send);
  finish({ status: 'accepted', receiptId: randomUUID() });
  await expect(first).rejects.toMatchObject({ code: 'PUSH_DELIVERY_LEASE_CHANGED' });
  expect((await state()).receipt_id).toBe(fresh);
});
test('invalid-token receipts cannot disable a refreshed registration', async () => {
  await service.send(await prepared());
  await db.pool.query('UPDATE push_installations SET revision=revision+1');
  provider.receipt.mockResolvedValueOnce({ status: 'invalid_token' });
  await service.receipt(await job('push.receipt'));
  expect((await state()).state).toBe('invalid_token');
  expect((await db.pool.query('SELECT enabled,revision FROM push_installations')).rows[0]).toEqual({
    enabled: true,
    revision: 2,
  });
});
test('invalid tokens disable the exact registration', async () => {
  provider.send.mockResolvedValueOnce({ status: 'invalid_token' });
  const send = await prepared();
  await service.send(send);
  expect((await db.pool.query('SELECT enabled FROM push_installations')).rows[0].enabled).toBe(false);
  expect((await state()).last_error).toBe('PUSH_INVALID_TOKEN');
  await service.send(send);
  expect(provider.send).toHaveBeenCalledOnce();
});
test('pending receipts schedule a new attempt and replaying an old receipt job is harmless', async () => {
  await service.send(await prepared());
  const first = await job('push.receipt');
  now = new Date(now.getTime() + 900000);
  provider.receipt.mockResolvedValueOnce({ status: 'pending' });
  await service.receipt(first);
  expect((await state()).receipt_attempts).toBe(1);
  await service.receipt(first);
  expect(provider.receipt).toHaveBeenCalledTimes(1);
  expect((await db.pool.query("SELECT * FROM outbox WHERE topic='push.receipt'")).rowCount).toBe(2);
  const second = await job('push.receipt');
  now = new Date(now.getTime() + 23 * 3600000);
  await service.receipt(second);
  expect((await state()).state).toBe('receipt_expired');
  expect(provider.receipt).toHaveBeenCalledTimes(1);
});
test('project send budget is shared in PostgreSQL and releases in the next time window', async () => {
  const send = await prepared();
  await db.pool.query("INSERT INTO push_rate_windows VALUES($1,date_trunc('second',$2::timestamptz),100)", [
    projects.rider,
    now,
  ]);
  await expect(service.send(send)).rejects.toMatchObject({ code: 'PUSH_SEND_RETRY' });
  expect(provider.send).not.toHaveBeenCalled();
  now = new Date(now.getTime() + 1000);
  await service.send(send);
  expect(provider.send).toHaveBeenCalledOnce();
});
test('recovery enqueues unfinished deliveries without resurrecting stale sends', async () => {
  await prepared();
  now = new Date(now.getTime() + 21 * 60000);
  expect(await service.sweep()).toBe(1);
  expect(await service.sweep()).toBe(1);
  expect((await db.pool.query("SELECT * FROM outbox WHERE dedupe_key LIKE 'push-recovery:%'")).rowCount).toBe(
    1,
  );
  await service.send(await job('push.send'));
  expect((await state()).state).toBe('suppressed');
  expect(provider.send).not.toHaveBeenCalled();
});

test('provider configuration failure stays visible without repeatedly sending', async () => {
  provider.send.mockResolvedValueOnce({ status: 'configuration' });
  const send = await prepared();
  await service.send(send);
  expect(await state()).toMatchObject({ state: 'configuration', last_error: 'PUSH_CONFIGURATION' });
  await service.send(send);
  expect(provider.send).toHaveBeenCalledOnce();
});
test('receipt provider outages schedule retry work instead of resending the notification', async () => {
  await service.send(await prepared());
  provider.receipt.mockRejectedValueOnce(new Error('private provider failure'));
  await service.receipt(await job('push.receipt'));
  expect(await state()).toMatchObject({
    state: 'receipt',
    last_error: 'PUSH_RECEIPT_UNCONFIRMED',
    receipt_attempts: 1,
  });
  expect(provider.send).toHaveBeenCalledOnce();
});

test('concurrent hosts share the same one-hundred-send project limit', async () => {
  const rows = (
    await db.pool.query<{ id: string }>(
      `WITH events AS (
    INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key,created_at,available_at)
    SELECT 'ride.matched',aggregate_id,'{}',gen_random_uuid()::text,$2,$2
    FROM outbox CROSS JOIN generate_series(1,101) WHERE id=$1 RETURNING id)
    INSERT INTO push_deliveries(event_id,installation_id,revision) SELECT id,$3,1 FROM events RETURNING id`,
      [eventId, now, installation],
    )
  ).rows;
  const results = await Promise.allSettled(
    rows.map((row) =>
      service.send({ id: randomUUID(), topic: 'push.send', aggregateId: row.id, payload: {}, attempt: 1 }),
    ),
  );
  expect(provider.send).toHaveBeenCalledTimes(100);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect((await db.pool.query('SELECT count FROM push_rate_windows')).rows[0].count).toBe(100);
});
test('receipt persistence and scheduling commit together; a failed commit remains recoverable', async () => {
  const send = await prepared();
  await db.pool.query(
    "ALTER TABLE outbox ADD CONSTRAINT fixture_receipt_failure CHECK(topic<>'push.receipt') NOT VALID",
  );
  try {
    await expect(service.send(send)).rejects.toThrow();
  } finally {
    await db.pool.query('ALTER TABLE outbox DROP CONSTRAINT fixture_receipt_failure');
  }
  expect(await state()).toMatchObject({ state: 'sending', receipt_id: null });
  now = new Date(now.getTime() + 61000);
  await service.send(send);
  expect((await state()).state).toBe('receipt');
  expect((await db.pool.query("SELECT * FROM outbox WHERE topic='push.receipt'")).rowCount).toBe(1);
  expect(provider.send).toHaveBeenCalledTimes(2);
});
