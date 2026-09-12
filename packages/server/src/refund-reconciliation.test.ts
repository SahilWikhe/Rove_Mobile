import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import type { PaymentReference, RefundProvider, RefundSnapshot } from './payment-provider';
import { RefundReconciler } from './refund-reconciliation';
let database: Awaited<ReturnType<typeof testDatabase>>;
let reference: PaymentReference;
let now: Date;
let reconcile: RefundReconciler;
const source = 'acct_fixture:test';
const refunds = vi.fn<RefundProvider['refunds']>();
function snapshot(items: RefundSnapshot[] = []) {
  return {
    payment: { ...reference, status: 'succeeded' as const, capturableCents: 0, receivedCents: 1050 },
    refunds: items,
  };
}
const item = (status: RefundSnapshot['status'] = 'pending'): RefundSnapshot => ({
  id: 're_fixture',
  intentId: reference.intentId,
  amountCents: 300,
  status,
  created: 1700000000,
});
beforeAll(async () => {
  database = await testDatabase();
}, 60_000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  await database.pool.query('TRUNCATE outbox,audit CASCADE');
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
  refunds.mockReset();
  refunds.mockImplementation(async () => snapshot());
  reconcile = new RefundReconciler(database.pool, { refunds }, source, () => now);
});

async function stored() {
  return (
    await database.pool.query('SELECT * FROM payment_refund_checks WHERE attempt_id=$1', [
      reference.attemptId,
    ])
  ).rows[0];
}
async function history() {
  return (await database.pool.query('SELECT * FROM payment_refund_observations ORDER BY revision')).rows;
}
test('provider observations update pending refunds to succeeded without changing capture or driver earnings', async () => {
  refunds.mockResolvedValueOnce(snapshot([item()])).mockResolvedValue(snapshot([item('succeeded')]));
  await reconcile.reconcile(reference.intentId);
  await reconcile.reconcile(reference.intentId);
  await reconcile.reconcile(reference.intentId);
  expect((await stored()).refunds[0].status).toBe('succeeded');
  expect((await stored()).revision).toBe(3);
  expect(await history()).toHaveLength(2);
  expect((await database.pool.query('SELECT payment_state,earnings_cents FROM rides')).rows[0]).toMatchObject(
    { payment_state: 'pending', earnings_cents: 790 },
  );
  expect((await database.pool.query('SELECT * FROM ledger_journals')).rowCount).toBe(0);
  await expect(database.pool.query("UPDATE payment_refund_observations SET refunds='[]'")).rejects.toThrow(
    'immutable',
  );
  await expect(database.pool.query('DELETE FROM payment_refund_observations')).rejects.toThrow('immutable');
});
test('duplicate concurrent reads cannot overwrite a newer refund result', async () => {
  await reconcile.reconcile(reference.intentId);
  let resolveOld!: (value: ReturnType<typeof snapshot>) => void;
  let started!: () => void;
  const begin = new Promise<void>((resolve) => (started = resolve));
  refunds
    .mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => (resolveOld = resolve));
    })
    .mockResolvedValueOnce(snapshot([item('succeeded')]));
  const old = reconcile.reconcile(reference.intentId);
  const rejected = expect(old).rejects.toMatchObject({ code: 'PAYMENT_REFUND_RETRY' });
  await begin;
  await reconcile.reconcile(reference.intentId);
  resolveOld(snapshot([item()]));
  await rejected;
  expect((await stored()).refunds[0].status).toBe('succeeded');
});
test('missing or mismatched references never invoke the provider', async () => {
  await expect(reconcile.reconcile('pi_unknown')).rejects.toMatchObject({
    code: 'PAYMENT_REFERENCE_PENDING',
  });
  await expect(
    reconcile.handle({
      id: randomUUID(),
      topic: 'refund.reconcile',
      aggregateId: randomUUID(),
      attempt: 1,
      payload: { source: 'acct_other:live', intentId: reference.intentId },
    }),
  ).rejects.toThrow();
  expect(refunds).not.toHaveBeenCalled();
});
test('incomplete or contradictory observations preserve the last verified history', async () => {
  refunds.mockResolvedValueOnce(snapshot([item()]));
  await reconcile.reconcile(reference.intentId);
  const initial = await stored();
  for (const bad of [
    snapshot([]),
    snapshot([{ ...item(), amountCents: 301 }]),
    snapshot([{ ...item(), intentId: 'pi_other' }]),
    snapshot([item(), item()]),
    snapshot([{ ...item(), amountCents: 2000 }]),
    { ...snapshot([item()]), payment: { ...snapshot().payment, customerId: 'cus_other' } },
  ]) {
    refunds.mockResolvedValueOnce(bad);
    await expect(reconcile.reconcile(reference.intentId)).rejects.toMatchObject({
      code: 'PAYMENT_REFUND_MISMATCH',
    });
    expect(await stored()).toEqual(initial);
  }
  expect(await history()).toHaveLength(1);
});
test('failed journal persistence rolls back the current observation and allows retry', async () => {
  await reconcile.reconcile(reference.intentId);
  const initial = await stored();
  await database.pool.query(
    'ALTER TABLE payment_refund_observations ADD CONSTRAINT fixture_reject CHECK (received_cents=0) NOT VALID',
  );
  refunds.mockResolvedValue(snapshot([item()]));
  try {
    await expect(reconcile.reconcile(reference.intentId)).rejects.toThrow();
    expect(await stored()).toEqual(initial);
  } finally {
    await database.pool.query('ALTER TABLE payment_refund_observations DROP CONSTRAINT fixture_reject');
  }
  await reconcile.reconcile(reference.intentId);
  expect((await stored()).refunds).toHaveLength(1);
});
test('sweep is source-scoped, bounded by age, and deduplicates wakeups', async () => {
  await database.pool.query("UPDATE rides SET payment_state='paid'");
  expect(await reconcile.sweep()).toBe(1);
  expect(await reconcile.sweep()).toBe(0);
  const job = (await database.pool.query('SELECT * FROM outbox')).rows[0];
  expect(job.topic).toBe('refund.reconcile');
  expect(job.payload).toEqual({ source, intentId: reference.intentId });
  await reconcile.reconcile(reference.intentId);
  now = new Date(now.getTime() + 30 * 60000);
  expect(await reconcile.sweep()).toBe(0);
  now = new Date(now.getTime() + 31 * 60000);
  expect(await reconcile.sweep()).toBe(1);
});

test('recovery advances past an unprocessed first page instead of starving later payments', async () => {
  await database.pool.query("UPDATE rides SET payment_state='paid'");
  for (let n = 1; n <= 104; n++) {
    const quote = randomUUID();
    const ride = randomUUID();
    await database.pool.query(
      `INSERT INTO quotes(id,rider_id,snapshot,expires_at)
      SELECT $1,rider_id,'{}',expires_at FROM quotes WHERE id=(SELECT quote_id FROM rides WHERE id=$2)`,
      [quote, reference.rideId],
    );
    await database.pool.query(
      `INSERT INTO rides(id,quote_id,rider_id,fare_cents,earnings_cents,search_deadline,payment_state,state)
      SELECT $1,$2,rider_id,fare_cents,earnings_cents,search_deadline,'paid','completed' FROM rides WHERE id=$3`,
      [ride, quote, reference.rideId],
    );
    await database.pool.query(
      `INSERT INTO payment_attempts(id,ride_id,customer_binding_id,intent_id,source,amount_cents)
      SELECT gen_random_uuid(),$1,customer_binding_id,$2,source,amount_cents FROM payment_attempts WHERE id=$3`,
      [ride, `pi_recovery_${n}`, reference.attemptId],
    );
  }
  expect(await reconcile.sweep()).toBe(100);
  // None of the first page has been processed or verified. The remaining five still advance.
  expect(await reconcile.sweep()).toBe(5);
  expect(await reconcile.sweep()).toBe(0);
  expect(
    (
      await database.pool.query(
        "SELECT count(DISTINCT aggregate_id)::int AS count FROM outbox WHERE topic='refund.reconcile'",
      )
    ).rows[0].count,
  ).toBe(105);
  expect(refunds).not.toHaveBeenCalled();
});
