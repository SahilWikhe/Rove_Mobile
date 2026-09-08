import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import type { PaymentProvider, PaymentReference, PaymentSnapshot } from './payment-provider';
import { PaymentReconciler } from './payment-reconciliation';
import { OutboxWorker } from './outbox';

let database: Awaited<ReturnType<typeof testDatabase>>;
let reference: PaymentReference;
let now: Date;
let reconcile: PaymentReconciler;
const retrieve = vi.fn<(reference: PaymentReference) => Promise<PaymentSnapshot>>();
const provider = { retrieve } as unknown as PaymentProvider;
const source = 'acct_fixture:test';
function snapshot(changes: Partial<PaymentSnapshot> = {}): PaymentSnapshot {
  return { ...reference, status: 'requires_capture', capturableCents: 1050, receivedCents: 0, ...changes };
}
async function state() {
  return (
    await database.pool.query('SELECT state,payment_state,version FROM rides WHERE id=$1', [reference.rideId])
  ).rows[0];
}
async function topics() {
  return (await database.pool.query('SELECT topic FROM outbox ORDER BY topic')).rows.map((r) => r.topic);
}
beforeAll(async () => {
  database = await testDatabase();
}, 60_000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  await database.pool.query('TRUNCATE outbox,audit');
  now = new Date('2026-09-07T12:00:00Z');
  const rider = randomUUID();
  const quote = randomUUID();
  const binding = randomUUID();
  reference = {
    rideId: randomUUID(),
    attemptId: randomUUID(),
    intentId: 'pi_fixture',
    customerId: 'cus_fixture',
    amountCents: 1050,
  };
  await database.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES ($1::uuid,$1::text,'Fixture rider','rider')",
    [rider],
  );
  await database.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES ($1,$2,'{}',$3)", [
    quote,
    rider,
    new Date(now.getTime() + 60000),
  ]);
  await database.pool.query(
    'INSERT INTO rides(id,quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES ($1,$2,$3,1050,790,$4)',
    [reference.rideId, quote, rider, new Date(now.getTime() + 180000)],
  );
  await database.pool.query(
    'INSERT INTO payment_customers(id,rider_id,source,customer_id) VALUES ($1,$2,$3,$4)',
    [binding, rider, source, reference.customerId],
  );
  await database.pool.query(
    'INSERT INTO payment_attempts(id,ride_id,customer_binding_id,intent_id,source,amount_cents) VALUES ($1,$2,$3,$4,$5,1050)',
    [reference.attemptId, reference.rideId, binding, reference.intentId, source],
  );
  retrieve.mockReset();
  retrieve.mockImplementation(async () => snapshot());
  reconcile = new PaymentReconciler(database.pool, provider, source, () => now);
});
test('full verified funding authorizes matching exactly once across repeated reconciliation', async () => {
  await reconcile.reconcile(reference.intentId);
  await reconcile.reconcile(reference.intentId);
  expect(await state()).toMatchObject({ payment_state: 'authorized', version: 2 });
  expect(await topics()).toEqual(['matching.tick', 'payment.updated']);
  expect(retrieve).toHaveBeenCalledWith(reference);
  expect((await database.pool.query('SELECT revision FROM payment_attempts')).rows[0].revision).toBe(2);
});
test('missing references and cross-environment jobs retry or reject without provider access', async () => {
  await expect(reconcile.reconcile('pi_unknown')).rejects.toMatchObject({
    code: 'PAYMENT_REFERENCE_PENDING',
  });
  await expect(
    reconcile.handle({
      id: randomUUID(),
      topic: 'payment.reconcile',
      aggregateId: randomUUID(),
      attempt: 1,
      payload: { source: 'acct_other:live', intentId: reference.intentId },
    }),
  ).rejects.toMatchObject({ code: 'PAYMENT_JOB_MISMATCH' });
  expect(retrieve).not.toHaveBeenCalled();
});
test('mismatched provider amount/customer/intent cannot change ride funding', async () => {
  for (const change of [
    { amountCents: 1051 },
    { customerId: 'cus_other' },
    { intentId: 'pi_other' },
    { capturableCents: 1051 },
  ]) {
    retrieve.mockResolvedValue(snapshot(change));
    await expect(reconcile.reconcile(reference.intentId)).rejects.toMatchObject({
      code: 'PAYMENT_REFERENCE_MISMATCH',
    });
  }
  expect(await state()).toMatchObject({ payment_state: 'pending', version: 1 });
  expect(await topics()).toEqual([]);
});
test('partial authorization and required authentication never start matching', async () => {
  retrieve.mockResolvedValue(snapshot({ capturableCents: 500 }));
  await reconcile.reconcile(reference.intentId);
  expect(await topics()).toEqual([]);
  retrieve.mockResolvedValue(snapshot({ status: 'requires_action', capturableCents: 0 }));
  await reconcile.reconcile(reference.intentId);
  expect(await state()).toMatchObject({ payment_state: 'action_required' });
  expect(await topics()).toEqual(['payment.updated']);
});
test('cancellation during provider fetch queues release and cannot restart matching', async () => {
  let release!: (value: PaymentSnapshot) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  retrieve.mockImplementationOnce(() => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const running = reconcile.reconcile(reference.intentId);
  await started;
  await database.pool.query("UPDATE rides SET state='cancelled',version=version+1 WHERE id=$1", [
    reference.rideId,
  ]);
  release(snapshot());
  await running;
  expect(await state()).toMatchObject({ state: 'cancelled', payment_state: 'release_pending', version: 3 });
  expect(await topics()).toEqual(['payment.release', 'payment.updated']);
});
test('expired search releases authorization and completed ride queues capture', async () => {
  now = new Date(now.getTime() + 180000);
  await reconcile.reconcile(reference.intentId);
  expect(await state()).toMatchObject({ payment_state: 'release_pending' });
  expect(await topics()).not.toContain('matching.tick');
  await database.pool.query("UPDATE rides SET state='completed',payment_state='authorized' WHERE id=$1", [
    reference.rideId,
  ]);
  await reconcile.reconcile(reference.intentId);
  expect(await state()).toMatchObject({ payment_state: 'capture_pending' });
  expect(await topics()).toContain('payment.capture');
});
test('older overlapping network response cannot overwrite a newer captured result', async () => {
  await database.pool.query("UPDATE rides SET state='completed' WHERE id=$1", [reference.rideId]);
  let release!: (value: PaymentSnapshot) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  retrieve.mockImplementationOnce(() => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const first = reconcile.reconcile(reference.intentId);
  // Attach the rejection assertion before resolving to avoid an unhandled rejection.
  const stale = expect(first).rejects.toMatchObject({ code: 'PAYMENT_RECONCILE_RETRY' });
  await started;
  retrieve.mockResolvedValue(snapshot({ status: 'succeeded', receivedCents: 1050, capturableCents: 0 }));
  await reconcile.reconcile(reference.intentId);
  release(snapshot());
  await stale;
  expect(await state()).toMatchObject({ payment_state: 'paid' });
  expect(await topics()).not.toContain('payment.capture');
});
test('settled funds never regress and partial captures require review', async () => {
  await database.pool.query("UPDATE rides SET state='completed',payment_state='paid' WHERE id=$1", [
    reference.rideId,
  ]);
  await expect(reconcile.reconcile(reference.intentId)).rejects.toMatchObject({
    code: 'PAYMENT_REFERENCE_MISMATCH',
  });
  expect(await state()).toMatchObject({ payment_state: 'paid' });
  expect((await database.pool.query('SELECT revision FROM payment_attempts')).rows[0].revision).toBe(0);
  await database.pool.query("UPDATE rides SET payment_state='capture_pending' WHERE id=$1", [
    reference.rideId,
  ]);
  retrieve.mockResolvedValue(snapshot({ status: 'succeeded', receivedCents: 500, capturableCents: 0 }));
  await reconcile.reconcile(reference.intentId);
  expect(await state()).toMatchObject({ payment_state: 'review_required' });
  expect(await topics()).toContain('payment.review_required');
});
test('provider failure leaves payment state, revision and queue unchanged', async () => {
  retrieve.mockRejectedValue(new Error('Fixture network failure'));
  await expect(reconcile.reconcile(reference.intentId)).rejects.toThrow('Fixture network failure');
  expect(await state()).toMatchObject({ payment_state: 'pending' });
  expect((await database.pool.query('SELECT revision FROM payment_attempts')).rows[0].revision).toBe(0);
  expect(await topics()).toEqual([]);
});

test('loss of funding revokes outstanding offers before another driver can accept', async () => {
  await reconcile.reconcile(reference.intentId);
  const driver = randomUUID();
  await database.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES ($1::uuid,$1::text,'Fixture driver','driver')",
    [driver],
  );
  await database.pool.query('INSERT INTO drivers(id) VALUES ($1)', [driver]);
  await database.pool.query(
    "INSERT INTO offers(ride_id,driver_id,expires_at,snapshot) VALUES ($1,$2,$3,'{}')",
    [reference.rideId, driver, new Date(now.getTime() + 20000)],
  );
  retrieve.mockResolvedValue(snapshot({ status: 'requires_payment_method', capturableCents: 0 }));
  await reconcile.reconcile(reference.intentId);
  expect(await state()).toMatchObject({ payment_state: 'pending' });
  expect((await database.pool.query('SELECT status FROM offers')).rows[0].status).toBe('revoked');
});
test('persisted fare or customer ownership mismatch cannot authorize the ride', async () => {
  await database.pool.query('UPDATE rides SET fare_cents=2000 WHERE id=$1', [reference.rideId]);
  await expect(reconcile.reconcile(reference.intentId)).rejects.toMatchObject({
    code: 'PAYMENT_REFERENCE_MISMATCH',
  });
  await database.pool.query('UPDATE rides SET fare_cents=1050 WHERE id=$1', [reference.rideId]);
  const other = randomUUID();
  await database.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES ($1::uuid,$1::text,'Other rider','rider')",
    [other],
  );
  await database.pool.query('UPDATE payment_customers SET rider_id=$1', [other]);
  await expect(reconcile.reconcile(reference.intentId)).rejects.toMatchObject({
    code: 'PAYMENT_REFERENCE_MISMATCH',
  });
  expect(await state()).toMatchObject({ payment_state: 'pending' });
  expect(await topics()).toEqual([]);
});

test('capture handler retries with one stable server-owned amount/key after reconciliation failure', async () => {
  await database.pool.query(
    "UPDATE rides SET state='completed',payment_state='capture_pending' WHERE id=$1",
    [reference.rideId],
  );
  let captured = false;
  const capture = vi.fn(async () => {
    captured = true;
    return snapshot({ status: 'succeeded', receivedCents: 1050, capturableCents: 0 });
  });
  const localProvider = {
    ...provider,
    capture,
    retrieve: vi.fn(async () => {
      if (captured) return snapshot({ status: 'succeeded', receivedCents: 1050, capturableCents: 0 });
      return snapshot();
    }),
  };
  localProvider.retrieve.mockRejectedValueOnce(new Error('Uncertain network response'));
  const service = new PaymentReconciler(database.pool, localProvider, source, () => now);
  const job = {
    id: randomUUID(),
    topic: 'payment.capture',
    aggregateId: reference.rideId,
    attempt: 1,
    payload: { attemptId: reference.attemptId },
  };
  await expect(service.capture(job)).rejects.toThrow('Uncertain network response');
  expect(await state()).toMatchObject({ payment_state: 'capture_pending' });
  await service.capture({ ...job, attempt: 2 });
  expect(await state()).toMatchObject({ payment_state: 'paid' });
  for (const call of capture.mock.calls)
    expect(call).toEqual([reference, 1050, `rove:${reference.attemptId}:capture`]);
});
test('release handler uses the persisted intent and cannot release an active funded trip', async () => {
  const cancel = vi.fn(async () => snapshot({ status: 'canceled', capturableCents: 0 }));
  const service = new PaymentReconciler(database.pool, { ...provider, cancel }, source, () => now);
  const job = {
    id: randomUUID(),
    topic: 'payment.release',
    aggregateId: reference.rideId,
    attempt: 1,
    payload: { attemptId: reference.attemptId },
  };
  await expect(service.release(job)).rejects.toMatchObject({ code: 'PAYMENT_OPERATION_NOT_ALLOWED' });
  expect(cancel).not.toHaveBeenCalled();
  await database.pool.query(
    "UPDATE rides SET state='cancelled',payment_state='release_pending' WHERE id=$1",
    [reference.rideId],
  );
  retrieve.mockResolvedValue(snapshot({ status: 'canceled', capturableCents: 0 }));
  await service.release(job);
  expect(cancel).toHaveBeenCalledWith(reference, `rove:${reference.attemptId}:release`);
  expect(await state()).toMatchObject({ payment_state: 'released' });
});

test('ride completion drives durable capture and verified settlement without waiting for a webhook', async () => {
  await database.pool.query("UPDATE rides SET state='completed',payment_state='authorized' WHERE id=$1", [
    reference.rideId,
  ]);
  let current = snapshot();
  const capture = vi.fn(async () => {
    current = snapshot({ status: 'succeeded', receivedCents: 1050, capturableCents: 0 });
    return current;
  });
  const service = new PaymentReconciler(
    database.pool,
    { ...provider, capture, retrieve: async () => current },
    source,
    () => now,
  );
  await database.pool.query(
    "INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES ('ride.completed',$1,'{}','fixture-completed')",
    [reference.rideId],
  );
  const worker = new OutboxWorker(
    database.pool,
    {
      ...service.handlers(),
      'payment.updated': async () => {}, // Notification delivery is outside this fixture.
    },
    () => new Date(Date.now() + 1000),
  ); // Include PostgreSQL's sub-millisecond enqueue timestamp.
  expect(await worker.runOnce(10)).toEqual({ processed: 4, failed: 0 });
  expect(await state()).toMatchObject({ payment_state: 'paid' });
  expect(capture).toHaveBeenCalledTimes(1);
  expect((await database.pool.query('SELECT * FROM outbox WHERE completed_at IS NULL')).rows).toHaveLength(0);
});
