import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { SearchExpiry } from './search-expiry';
import { PaymentReconciler } from './payment-reconciliation';
import type { PaymentProvider, PaymentReference } from './payment-provider';
let database: Awaited<ReturnType<typeof testDatabase>>;
let expiry: SearchExpiry;
let ride: string;
let rider: string;
let now: Date;
beforeAll(async () => {
  database = await testDatabase();
}, 60000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  await database.pool.query('TRUNCATE outbox CASCADE');
  now = new Date('2026-09-07T12:00:00Z');
  rider = randomUUID();
  ride = randomUUID();
  const quote = randomUUID();
  await database.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Fixture','rider')",
    [rider],
  );
  await database.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',$3)", [
    quote,
    rider,
    now,
  ]);
  await database.pool.query(
    'INSERT INTO rides(id,quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,1050,790,$4)',
    [ride, quote, rider, new Date(now.getTime() + 180000)],
  );
  expiry = new SearchExpiry(database.pool, () => now);
});
async function state() {
  return (await database.pool.query('SELECT state,payment_state,version FROM rides WHERE id=$1', [ride]))
    .rows[0];
}
function deadline() {
  now = new Date(now.getTime() + 180000);
}
test('expiry leaves requests open before their deadline and preserves uncertain funding after cancellation', async () => {
  expect(await expiry.expire(ride)).toBe(false);
  expect((await state()).state).toBe('searching');
  deadline();
  expect(await expiry.expire(ride)).toBe(true);
  expect(await state()).toMatchObject({ state: 'cancelled', payment_state: 'pending', version: 2 });
  expect((await database.pool.query('SELECT topic,payload FROM outbox')).rows).toEqual([
    { topic: 'ride.cancelled', payload: { reason: 'search_deadline_expired' } },
  ]);
  const quote = randomUUID();
  await database.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',$3)", [
    quote,
    rider,
    now,
  ]);
  // The active-rider uniqueness constraint now permits a new reviewed booking.
  await expect(
    database.pool.query(
      'INSERT INTO rides(quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,1050,790,$3)',
      [quote, rider, now],
    ),
  ).resolves.toMatchObject({ rowCount: 1 });
});
test('funded searches expire as no-driver without fabricating release', async () => {
  await database.pool.query("UPDATE rides SET payment_state='authorized' WHERE id=$1", [ride]);
  deadline();
  await expiry.expire(ride);
  expect(await state()).toMatchObject({ state: 'no_driver_found', payment_state: 'authorized' });
  expect((await database.pool.query('SELECT topic FROM outbox')).rows).toEqual([
    { topic: 'ride.no_driver_found' },
  ]);
});
test('duplicate expiry workers serialize one transition and leave an already assigned ride intact', async () => {
  deadline();
  expect((await Promise.all([expiry.expire(ride), expiry.expire(ride)])).sort()).toEqual([false, true]);
  expect((await database.pool.query('SELECT id FROM audit')).rowCount).toBe(1);
  await database.pool.query("UPDATE rides SET state='matched' WHERE id=$1", [ride]);
  expect(await expiry.expire(ride)).toBe(false);
  expect((await state()).state).toBe('matched');
});
test('bounded sweep recovers missing historical deadline jobs', async () => {
  expect(await expiry.sweep()).toBe(0);
  deadline();
  expect(await expiry.sweep(1)).toBe(1);
  expect(await expiry.sweep(1)).toBe(0);
  await expect(expiry.sweep(101)).rejects.toThrow('Invalid sweep limit');
});
test('a provider authorization fetched before expiry cannot resurrect the cancelled request', async () => {
  const binding = randomUUID();
  const attempt = randomUUID();
  await database.pool.query(
    "INSERT INTO payment_customers(id,rider_id,source,customer_id) VALUES($1,$2,'acct_fixture:test','cus_fixture')",
    [binding, rider],
  );
  await database.pool.query(
    "INSERT INTO payment_attempts(id,ride_id,customer_binding_id,intent_id,source,amount_cents) VALUES($1,$2,$3,'pi_fixture','acct_fixture:test',1050)",
    [attempt, ride, binding],
  );
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const retrieve = vi.fn(async (reference: PaymentReference) => {
    entered();
    await waiting;
    return { ...reference, status: 'requires_capture' as const, capturableCents: 1050, receivedCents: 0 };
  });
  const reconciler = new PaymentReconciler(
    database.pool,
    { retrieve } as unknown as PaymentProvider,
    'acct_fixture:test',
    () => now,
  );
  const reconciling = reconciler.reconcile('pi_fixture');
  await started;
  deadline();
  await expiry.expire(ride);
  release();
  await reconciling;
  expect(await state()).toMatchObject({ state: 'cancelled', payment_state: 'release_pending' });
  const topics = (await database.pool.query('SELECT topic FROM outbox')).rows.map((row) => row.topic);
  expect(topics).toContain('payment.release');
  expect(topics).not.toContain('matching.tick');
});
test('never-started payments need no release call but incomplete attempts must retry', async () => {
  deadline();
  await expiry.expire(ride);
  const retrieve = vi.fn();
  const reconciler = new PaymentReconciler(
    database.pool,
    { retrieve } as unknown as PaymentProvider,
    'acct_fixture:test',
    () => now,
  );
  const job = { id: randomUUID(), topic: 'ride.cancelled', aggregateId: ride, payload: {}, attempt: 1 };
  await expect(reconciler.rideChanged(job)).resolves.toBeUndefined();
  expect(retrieve).not.toHaveBeenCalled();
  const binding = randomUUID();
  await database.pool.query(
    "INSERT INTO payment_customers(id,rider_id,source,customer_id) VALUES($1,$2,'acct_fixture:test','cus_fixture')",
    [binding, rider],
  );
  await database.pool.query(
    "INSERT INTO payment_attempts(ride_id,customer_binding_id,source,amount_cents) VALUES($1,$2,'acct_fixture:test',1050)",
    [ride, binding],
  );
  await expect(reconciler.rideChanged(job)).rejects.toMatchObject({ code: 'PAYMENT_REFERENCE_PENDING' });
  await database.pool.query("UPDATE payment_attempts SET source='acct_other:test' WHERE ride_id=$1", [ride]);
  await expect(reconciler.rideChanged(job)).rejects.toMatchObject({ code: 'PAYMENT_REFERENCE_MISMATCH' });
});

test('expiry and audit roll back when durable payment cleanup cannot be enqueued', async () => {
  deadline();
  await database.pool.query(
    "ALTER TABLE outbox ADD CONSTRAINT expiry_enqueue_fixture CHECK(topic <> 'ride.cancelled') NOT VALID",
  );
  try {
    await expect(expiry.expire(ride)).rejects.toThrow();
    expect(await state()).toMatchObject({ state: 'searching', version: 1 });
    expect((await database.pool.query('SELECT id FROM audit')).rowCount).toBe(0);
  } finally {
    await database.pool.query('ALTER TABLE outbox DROP CONSTRAINT expiry_enqueue_fixture');
  }
  expect(await expiry.expire(ride)).toBe(true);
});
