import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import type { PaymentReference, RefundProvider, RefundSnapshot } from './payment-provider';
import { RefundReconciler } from './refund-reconciliation';
import { RefundOperations } from './refund-operations';
import { DisputeReconciler, type DisputeSnapshot } from './disputes';
import { recordCapturedFunds } from './ledger';
import { transaction } from './transactions';
import type { Actor } from './rides';
import type { PaymentProvider } from './payment-provider';
let staff: Actor;
let operations: RefundOperations;
const refund = vi.fn<PaymentProvider['refund']>();
const authorization = {
  amountCents: 300,
  reason: 'customer_request' as const,
  policyReference: 'fixture-policy-v1',
};

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
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  await database.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Fixture staff','staff')",
    [staff.id],
  );
  await database.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'payments.refund')",
    [staff.id],
  );
  await transaction(database.pool, (c) =>
    recordCapturedFunds(c, {
      attemptId: reference.attemptId,
      rideId: reference.rideId,
      riderId: rider,
      receivedCents: 1050,
      driverId: null,
      earningsCents: 0,
      completed: false,
      fullFare: true,
    }),
  );
  await reconcile.reconcile(reference.intentId);
  refund.mockReset();
  refund.mockResolvedValue({ id: 're_created', amountCents: 300, status: 'pending' });
  operations = new RefundOperations(database.pool, { refund }, reconcile, source, () => now);
});

async function execute(id: string) {
  return operations.handle({
    id: randomUUID(),
    aggregateId: id,
    topic: 'refund.execute',
    attempt: 1,
    payload: { source, operationId: id },
  });
}
async function row(id: string) {
  return (await database.pool.query('SELECT * FROM refund_operations WHERE id=$1', [id])).rows[0];
}
test('authorization is MFA/permission restricted even when replaying an existing command', async () => {
  for (const actor of [
    { ...staff, role: 'rider' as const },
    { ...staff, mfa: false },
  ])
    await expect(
      operations.authorize(actor, reference.rideId, authorization, 'fixture-key-one'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const op = await operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one');
  expect(await operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one')).toEqual(op);
  expect(refund).not.toHaveBeenCalled();
  await database.pool.query('DELETE FROM staff_permissions');
  await expect(
    operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one'),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await database.pool.query("SELECT * FROM outbox WHERE topic='refund.execute'")).rowCount).toBe(1);
});
test('concurrent authorizations reserve funds atomically and reject an uncertain second operation', async () => {
  const results = await Promise.allSettled(
    ['first-key', 'second-key'].map((key) =>
      operations.authorize(staff, reference.rideId, { ...authorization, amountCents: 700 }, key),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await database.pool.query('SELECT * FROM refund_operations')).rowCount).toBe(1);
  expect(refund).not.toHaveBeenCalled();
});
test('external refunds, stale checks, and missing capture journals cannot authorize extra money', async () => {
  refunds.mockResolvedValue(snapshot([{ ...item(), amountCents: 900, status: 'succeeded' }]));
  await reconcile.reconcile(reference.intentId);
  await expect(
    operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one'),
  ).rejects.toMatchObject({ code: 'REFUND_LIMIT' });
  now = new Date(now.getTime() + 300001);
  await expect(
    operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one'),
  ).rejects.toMatchObject({ code: 'REFUND_REVIEW_REQUIRED' });
  await reconcile.reconcile(reference.intentId);
  await database.pool.query('TRUNCATE ledger_journals CASCADE');
  await expect(
    operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one'),
  ).rejects.toMatchObject({ code: 'REFUND_REVIEW_REQUIRED' });
});
test('lost provider response replays the same key and records submission separately from success', async () => {
  const op = await operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one');
  refund.mockRejectedValueOnce(new Error('uncertain network'));
  await expect(execute(op.id)).rejects.toThrow('uncertain network');
  expect((await row(op.id)).first_attempt_at).toBeTruthy();
  // The refund can already appear in provider history after the response was lost.
  refunds.mockResolvedValue(snapshot([{ ...item('pending'), id: 're_created' }]));
  await reconcile.reconcile(reference.intentId);
  await execute(op.id);
  expect(refund.mock.calls.map((c) => c[2])).toEqual([`rove-refund:${op.id}`, `rove-refund:${op.id}`]);
  expect(await row(op.id)).toMatchObject({ state: 'submitted', provider_refund_id: 're_created' });
  await execute(op.id);
  expect(refund).toHaveBeenCalledTimes(2);
  expect((await operations.list(staff, reference.rideId)).operations[0]).toMatchObject({
    state: 'submitted',
    amountCents: 300,
  });
  expect(JSON.stringify(await operations.list(staff, reference.rideId))).not.toContain('re_created');
});
test('aged unknown responses require review without another refund mutation', async () => {
  const op = await operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one');
  refund.mockRejectedValueOnce(new Error('uncertain'));
  await expect(execute(op.id)).rejects.toThrow();
  now = new Date(now.getTime() + 23 * 3600000);
  await execute(op.id);
  expect((await row(op.id)).state).toBe('review_required');
  expect(refund).toHaveBeenCalledTimes(1);
});
test('verified failed refunds release the limit while succeeded refunds remain deducted', async () => {
  const first = await operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one');
  await execute(first.id);
  refunds.mockResolvedValue(snapshot([{ ...item('failed'), id: 're_created' }]));
  await reconcile.reconcile(reference.intentId);
  const second = await operations.authorize(
    staff,
    reference.rideId,
    { ...authorization, amountCents: 1000 },
    'fixture-key-two',
  );
  expect(second.amountCents).toBe(1000);
  await expect(
    database.pool.query('UPDATE refund_operations SET amount_cents=1 WHERE id=$1', [first.id]),
  ).rejects.toThrow('immutable');
  await expect(database.pool.query('DELETE FROM refund_operations WHERE id=$1', [first.id])).rejects.toThrow(
    'immutable',
  );
});
test('authorization and outbox insertion roll back together when durable enqueue fails', async () => {
  await database.pool.query(
    "ALTER TABLE outbox ADD CONSTRAINT fixture_block_refunds CHECK(topic<>'refund.execute') NOT VALID",
  );
  try {
    await expect(
      operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one'),
    ).rejects.toThrow();
  } finally {
    await database.pool.query('ALTER TABLE outbox DROP CONSTRAINT fixture_block_refunds');
  }
  expect((await database.pool.query('SELECT * FROM refund_operations')).rowCount).toBe(0);
  await operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one');
  expect((await database.pool.query('SELECT * FROM refund_operations')).rowCount).toBe(1);
});
test('a changed payload cannot reuse authorization and provider mismatches never mark submission', async () => {
  const op = await operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one');
  await expect(
    operations.authorize(staff, reference.rideId, { ...authorization, amountCents: 301 }, 'fixture-key-one'),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  refund.mockResolvedValue({ id: 're_created', amountCents: 301, status: 'succeeded' });
  await expect(execute(op.id)).rejects.toMatchObject({ code: 'REFUND_REVIEW_REQUIRED' });
  expect((await row(op.id)).provider_refund_id).toBeNull();
});

test('provider success followed by a database failure retries the same operation without losing authorization', async () => {
  const op = await operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one');
  await database.pool.query(
    "ALTER TABLE refund_operations ADD CONSTRAINT fixture_submission_failure CHECK(state<>'submitted') NOT VALID",
  );
  try {
    await expect(execute(op.id)).rejects.toThrow();
  } finally {
    await database.pool.query('ALTER TABLE refund_operations DROP CONSTRAINT fixture_submission_failure');
  }
  expect(await row(op.id)).toMatchObject({ state: 'queued', provider_refund_id: null });
  await execute(op.id);
  expect(refund.mock.calls.map((c) => c[2])).toEqual([`rove-refund:${op.id}`, `rove-refund:${op.id}`]);
  expect((await row(op.id)).state).toBe('submitted');
});

test('read-only metadata recovery resolves an aged lost response without a second refund', async () => {
  const op = await operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one');
  refund.mockRejectedValueOnce(new Error('uncertain'));
  await expect(execute(op.id)).rejects.toThrow();
  const created = Math.floor(now.getTime() / 1000);
  now = new Date(now.getTime() + 25 * 3600000);
  refunds.mockResolvedValue(
    snapshot([{ ...item('succeeded'), id: 're_recovered', operationId: op.id, created }]),
  );
  expect(await operations.recover(staff, reference.rideId, op.id)).toMatchObject({ state: 'submitted' });
  await execute(op.id);
  expect(refund).toHaveBeenCalledTimes(1);
  expect((await row(op.id)).provider_refund_id).toBe('re_recovered');
  expect(
    (
      await database.pool.query(
        "SELECT actor_id FROM audit WHERE action='refund.submission_recovered' AND aggregate_id=$1",
        [op.id],
      )
    ).rows[0].actor_id,
  ).toBe(staff.id);
  await expect(operations.recover({ ...staff, mfa: false }, reference.rideId, op.id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
test('recovery never guesses from equal amounts or binds contradictory operation metadata', async () => {
  const op = await operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one');
  refund.mockRejectedValueOnce(new Error('uncertain'));
  await expect(execute(op.id)).rejects.toThrow();
  now = new Date(now.getTime() + 25 * 3600000);
  refunds.mockResolvedValue(snapshot([{ ...item('succeeded'), created: Math.floor(now.getTime() / 1000) }]));
  await execute(op.id);
  expect((await row(op.id)).state).toBe('review_required');
  expect(refund).toHaveBeenCalledTimes(1);
  refunds.mockResolvedValue(
    snapshot([
      {
        ...item('succeeded'),
        created: Math.floor(now.getTime() / 1000),
        operationId: op.id,
        amountCents: 301,
      },
    ]),
  );
  await expect(operations.recover(staff, reference.rideId, op.id)).rejects.toThrow();
  expect((await row(op.id)).provider_refund_id).toBeNull();
});

test.each(['duplicate', 'future'] as const)(
  'recovery rejects %s metadata evidence without binding or mutating again',
  async (kind) => {
    const op = await operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one');
    refund.mockRejectedValueOnce(new Error('uncertain'));
    await expect(execute(op.id)).rejects.toThrow();
    const candidate = {
      ...item('succeeded'),
      operationId: op.id,
      created: Math.floor(now.getTime() / 1000) + (kind === 'future' ? 121 : 0),
    };
    refunds.mockResolvedValue(
      snapshot(kind === 'duplicate' ? [candidate, { ...candidate, id: 're_second' }] : [candidate]),
    );
    await expect(operations.recover(staff, reference.rideId, op.id)).rejects.toMatchObject({
      code: 'REFUND_REVIEW_REQUIRED',
    });
    expect((await row(op.id)).provider_refund_id).toBeNull();
    expect(refund).toHaveBeenCalledTimes(1);
  },
);

test('an enabled dispute guard blocks both authorization and a dispute discovered after authorization', async () => {
  let history: DisputeSnapshot[] = [];
  const disputes = new DisputeReconciler(
    database.pool,
    {
      disputes: async (ref) => ({
        payment: { ...ref, status: 'succeeded', receivedCents: 1050, capturableCents: 0 },
        disputes: history,
      }),
    },
    source,
    () => now,
  );
  operations = new RefundOperations(database.pool, { refund }, reconcile, source, () => now, disputes);
  await expect(
    operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one'),
  ).rejects.toMatchObject({ code: 'DISPUTE_PAYMENT_HOLD' });
  await disputes.reconcile(reference.intentId);
  const op = await operations.authorize(staff, reference.rideId, authorization, 'fixture-key-one');
  history = [
    {
      id: 'du_fixture',
      intentId: reference.intentId,
      amountCents: 1050,
      status: 'needs_response',
      reason: 'general',
      created: 1700000000,
      dueBy: null,
      balanceTransactions: [],
    },
  ];
  await expect(execute(op.id)).rejects.toMatchObject({ code: 'DISPUTE_PAYMENT_HOLD' });
  expect(refund).not.toHaveBeenCalled();
  expect((await row(op.id)).first_attempt_at).toBeNull();
});
