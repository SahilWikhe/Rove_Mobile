import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, expect, test, vi } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { DriverTransfers } from './driver-transfers';
import { RefundOperations } from './refund-operations';
import { RefundReconciler } from './refund-reconciliation';
import { DisputeReconciler } from './disputes';
import { PaymentLosses } from './payment-losses';
import { OutboxWorker } from './outbox';
import { recordCapturedFunds } from './ledger';
import { transaction } from './transactions';
import type { Actor } from './rides';
import type { DriverTransferReference, DriverTransferSnapshot } from './driver-transfer-provider';
let db: Awaited<ReturnType<typeof testDatabase>>;
let staff: Actor, rideId: string, driverId: string, attemptId: string;
let now: Date, service: DriverTransfers;
const source = 'acct_fixture:test';
const policy = { amountCents: 600, policyReference: 'fixture-approved-policy-v1' };
const observed = new Map<string, DriverTransferSnapshot>();
const funding = vi.fn(),
  create = vi.fn(),
  find = vi.fn(),
  retrieve = vi.fn(),
  refresh = vi.fn();
const reference = (r: DriverTransferReference): DriverTransferSnapshot => ({
  id: `tr_${r.operationId.replaceAll('-', '')}`,
  created: Math.floor(now.getTime() / 1000),
  amountCents: r.amountCents,
  reversedCents: 0,
  movements: [
    {
      id: `txn_${r.operationId.replaceAll('-', '')}`,
      sourceId: `tr_${r.operationId.replaceAll('-', '')}`,
      kind: 'transfer',
      amountCents: -r.amountCents,
      feeCents: 2,
      netCents: -r.amountCents - 2,
    },
  ],
});
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  await db.pool.query('TRUNCATE outbox CASCADE');
  vi.resetAllMocks();
  observed.clear();
  now = new Date('2026-09-12T20:00:00Z');
  const rider = randomUUID(),
    quote = randomUUID(),
    binding = randomUUID();
  driverId = randomUUID();
  rideId = randomUUID();
  attemptId = randomUUID();
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  for (const [id, role] of [
    [rider, 'rider'],
    [driverId, 'driver'],
    [staff.id, 'staff'],
  ])
    await db.pool.query("INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Fixture',$2)", [
      id,
      role,
    ]);
  await db.pool.query('INSERT INTO drivers(id,approved,eligibility_expires_at) VALUES($1,true,$2)', [
    driverId,
    new Date(now.getTime() + 86400000),
  ]);
  await db.pool.query(
    "INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now()+interval '1 minute')",
    [quote, rider],
  );
  await db.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,driver_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,$4,'completed',1050,790,now())",
    [rideId, quote, rider, driverId],
  );
  await db.pool.query(
    "INSERT INTO payment_customers(id,rider_id,source,customer_id) VALUES($1,$2,$3,'cus_fixture')",
    [binding, rider, source],
  );
  await db.pool.query(
    "INSERT INTO payment_attempts(id,ride_id,customer_binding_id,intent_id,source,amount_cents) VALUES($1,$2,$3,'pi_fixture',$4,1050)",
    [attemptId, rideId, binding, source],
  );
  await db.pool.query(
    "INSERT INTO driver_payout_accounts(driver_id,source,account_id) VALUES($1,$2,'acct_driver')",
    [driverId, source],
  );
  await db.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'payments.transfer'),($1,'payments.loss.allocate')",
    [staff.id],
  );
  await db.pool.query(
    'INSERT INTO payment_refund_checks(attempt_id,verified_at,received_cents) VALUES($1,$2,1050)',
    [attemptId, now],
  );
  await db.pool.query('INSERT INTO payment_dispute_checks(attempt_id,verified_at) VALUES($1,$2)', [
    attemptId,
    now,
  ]);
  await transaction(db.pool, (c) =>
    recordCapturedFunds(c, {
      attemptId,
      rideId,
      riderId: rider,
      driverId,
      receivedCents: 1050,
      earningsCents: 790,
      completed: true,
      fullFare: true,
    }),
  );
  funding.mockResolvedValue({ chargeId: 'ch_fixture', unrefundedCents: 1050 });
  create.mockImplementation(async (r: DriverTransferReference) => {
    if (!observed.has(r.operationId)) observed.set(r.operationId, reference(r));
    return structuredClone(observed.get(r.operationId)!);
  });
  find.mockImplementation(async (r: DriverTransferReference) =>
    structuredClone(observed.get(r.operationId) ?? null),
  );
  retrieve.mockImplementation(async (r: DriverTransferReference) =>
    structuredClone(observed.get(r.operationId)!),
  );
  refresh.mockImplementation(async () => {
    await db.pool.query('UPDATE payment_refund_checks SET verified_at=$1', [now]);
    await db.pool.query('UPDATE payment_dispute_checks SET verified_at=$1', [now]);
  });
  const disputes = new DisputeReconciler(db.pool, { disputes: vi.fn() }, source, () => now);
  service = new DriverTransfers(
    db.pool,
    { funding, create, find, retrieve },
    { reconcile: refresh },
    { reconcile: refresh, assertRefundable: disputes.assertRefundable.bind(disputes) },
    source,
    () => now,
  );
});
const authorize = (key = 'transfer-one', amount = 600) =>
  service.authorize(staff, rideId, { ...policy, amountCents: amount }, key);
const run = (id: string) =>
  service.handle({
    id: randomUUID(),
    topic: 'transfer.execute',
    aggregateId: id,
    payload: { source, operationId: id },
    attempt: 1,
  });
async function balances() {
  return Object.fromEntries(
    (
      await db.pool.query(
        'SELECT account,sum(amount_cents)::int AS amount FROM ledger_postings GROUP BY account',
      )
    ).rows.map((r) => [r.account, r.amount]),
  );
}
async function op(id: string) {
  return (await db.pool.query('SELECT * FROM driver_transfer_operations WHERE id=$1', [id])).rows[0];
}
function reverse(id: string, amount = 100) {
  const snapshot = observed.get(id)!;
  snapshot.reversedCents = amount;
  snapshot.movements.push({
    id: 'txn_return',
    sourceId: 'trr_return',
    kind: 'transfer_refund',
    amountCents: amount,
    feeCents: -1,
    netCents: amount + 1,
  });
}
test('authorization atomically reserves earnings with audit and outbox; worker confirms exactly once', async () => {
  const a = await authorize();
  expect(a.state).toBe('queued');
  expect(await balances()).toMatchObject({
    driver_payable: -190,
    driver_transfer_pending: -600,
    stripe_clearing: 1050,
  });
  expect(create).not.toHaveBeenCalled();
  expect(await authorize()).toEqual(a);
  const worker = new OutboxWorker(db.pool, { 'transfer.execute': service.handle });
  expect(await worker.runOnce()).toEqual({ processed: 1, failed: 0 });
  await run(a.id);
  expect(create).toHaveBeenCalledTimes(1);
  expect((await op(a.id)).state).toBe('confirmed');
  expect(await balances()).toMatchObject({
    driver_payable: -190,
    driver_transfer_pending: 0,
    stripe_clearing: 448,
    processor_fees: 2,
  });
  expect((await db.pool.query('SELECT * FROM driver_transfer_movements')).rowCount).toBe(1);
  expect((await db.pool.query("SELECT * FROM audit WHERE action='driver_transfer.verified'")).rowCount).toBe(
    1,
  );
  await expect(authorize('over-remaining', 191)).rejects.toMatchObject({ code: 'TRANSFER_REVIEW_REQUIRED' });
});
test('concurrent authorizations and workers cannot reserve or settle twice', async () => {
  const results = await Promise.allSettled([authorize('parallel-one'), authorize('parallel-two')]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const id = (await db.pool.query('SELECT id FROM driver_transfer_operations')).rows[0].id;
  await Promise.all([run(id), run(id)]);
  await run(id);
  expect(observed.size).toBe(1);
  expect(
    (await db.pool.query("SELECT * FROM ledger_journals WHERE kind='driver_transfer_balance'")).rowCount,
  ).toBe(1);
  expect(await balances()).toMatchObject({ driver_payable: -190, driver_transfer_pending: 0 });
});
test('cancel before first attempt releases reservation and stale delivery cannot transfer', async () => {
  const a = await authorize();
  await service.cancel(staff, rideId, a.id, 'cancel-one');
  await service.cancel(staff, rideId, a.id, 'cancel-two');
  await run(a.id);
  expect(await balances()).toMatchObject({ driver_payable: -790, driver_transfer_pending: 0 });
  expect(create).not.toHaveBeenCalled();
  await expect(
    db.pool.query("UPDATE driver_transfer_operations SET state='queued' WHERE id=$1", [a.id]),
  ).rejects.toMatchObject({ code: '23514' });
});
test('lost response retains reservation and recovers beyond retry cutoff without another mutation', async () => {
  create.mockImplementationOnce(async (r: DriverTransferReference) => {
    observed.set(r.operationId, reference(r));
    throw new Error('network response lost');
  });
  const a = await authorize();
  await expect(run(a.id)).rejects.toThrow('network response lost');
  expect(await balances()).toMatchObject({ driver_transfer_pending: -600 });
  await expect(service.cancel(staff, rideId, a.id, 'cancel-unknown')).rejects.toMatchObject({
    code: 'TRANSFER_REVIEW_REQUIRED',
  });
  now = new Date(now.getTime() + 24 * 3600000);
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [driverId]);
  expect((await service.recover(staff, rideId, a.id)).state).toBe('confirmed');
  expect(create).toHaveBeenCalledTimes(1);
  expect(await balances()).toMatchObject({ driver_transfer_pending: 0, stripe_clearing: 448 });
});
test('unresolved old attempts become review-required with funds reserved and cannot be reauthorized', async () => {
  create.mockRejectedValue(new Error('unknown'));
  const a = await authorize();
  await expect(run(a.id)).rejects.toThrow('unknown');
  now = new Date(now.getTime() + 23 * 3600000);
  await run(a.id);
  expect((await op(a.id)).state).toBe('review_required');
  expect(create).toHaveBeenCalledTimes(1);
  expect(await balances()).toMatchObject({ driver_transfer_pending: -600 });
  await expect(authorize('replacement')).rejects.toBeDefined();
});
test('all operations require active MFA staff permission including cached command results', async () => {
  await expect(
    service.authorize({ ...staff, mfa: false }, rideId, policy, 'no-mfa-key'),
  ).rejects.toMatchObject({ status: 403 });
  const a = await authorize();
  await db.pool.query('DELETE FROM staff_permissions WHERE staff_id=$1', [staff.id]);
  for (const action of [
    () => authorize(),
    () => service.list(staff, rideId),
    () => service.cancel(staff, rideId, a.id, 'forbidden-cancel'),
    () => service.recover(staff, rideId, a.id),
  ])
    await expect(action()).rejects.toMatchObject({ status: 403 });
  expect(create).not.toHaveBeenCalled();
});
test('financial holds block authorization and execution, including a new hold after reservation', async () => {
  await db.pool.query('UPDATE payment_refund_checks SET refunds=$1', [
    JSON.stringify([{ id: 're_pending', amountCents: 100, status: 'pending' }]),
  ]);
  await expect(authorize()).rejects.toMatchObject({ code: 'TRANSFER_REVIEW_REQUIRED' });
  await db.pool.query("UPDATE payment_refund_checks SET refunds='[]'");
  const a = await authorize();
  await db.pool.query('UPDATE drivers SET approved=false WHERE id=$1', [driverId]);
  await expect(run(a.id)).rejects.toMatchObject({ code: 'TRANSFER_REVIEW_REQUIRED' });
  expect(create).not.toHaveBeenCalled();
  expect((await op(a.id)).first_attempt_at).toBeNull();
});
test('stale facts, unresolved refund authorization and source mismatch are rejected', async () => {
  await db.pool.query('UPDATE payment_refund_checks SET verified_at=$1', [new Date(now.getTime() - 301000)]);
  await expect(authorize()).rejects.toBeDefined();
  await refresh();
  await db.pool.query(
    "INSERT INTO refund_operations(attempt_id,authorized_by,amount_cents,reason,policy_reference) VALUES($1,$2,100,'customer_request','fixture')",
    [attemptId, staff.id],
  );
  await expect(authorize()).rejects.toBeDefined();
  expect(await balances()).toMatchObject({ driver_payable: -790 });
  const other = new DriverTransfers(
    db.pool,
    { funding, create, find, retrieve },
    { reconcile: refresh },
    { reconcile: refresh, assertRefundable: vi.fn() },
    'acct_other:test',
    () => now,
  );
  await expect(other.authorize(staff, rideId, policy, 'source-isolation')).rejects.toBeDefined();
});
test('reversals book actual returned money once and require review before it can be paid again', async () => {
  const a = await authorize();
  await run(a.id);
  reverse(a.id);
  await service.recover(staff, rideId, a.id);
  await service.recover(staff, rideId, a.id);
  expect((await op(a.id)).state).toBe('review_required');
  expect(await balances()).toMatchObject({ driver_payable: -290, stripe_clearing: 549, processor_fees: 1 });
  expect((await db.pool.query('SELECT * FROM driver_transfer_movements')).rowCount).toBe(2);
  await expect(authorize('pay-again', 100)).rejects.toMatchObject({ code: 'TRANSFER_REVIEW_REQUIRED' });
  await expect(
    db.pool.query('UPDATE driver_transfer_movements SET balance_id=$1', ['txn_modified']),
  ).rejects.toMatchObject({ code: '23514' });
});
test('a slower older provider observation cannot undo a newly verified reversal', async () => {
  const a = await authorize();
  await run(a.id);
  const older = structuredClone(observed.get(a.id)!);
  let release!: (value: DriverTransferSnapshot) => void, started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  retrieve.mockImplementationOnce(
    () =>
      new Promise<DriverTransferSnapshot>((resolve) => {
        release = resolve;
        started();
      }),
  );
  const slow = service.recover(staff, rideId, a.id);
  await waiting;
  reverse(a.id);
  await service.recover(staff, rideId, a.id);
  release(older);
  await slow;
  expect((await op(a.id)).reversed_cents).toBe(100);
  expect(await balances()).toMatchObject({ driver_payable: -290 });
});
test('audit failure rolls back authorization and financial reservation together', async () => {
  await db.pool.query(
    "CREATE FUNCTION fixture_fail_transfer_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$",
  );
  await db.pool.query(
    'CREATE TRIGGER fixture_transfer_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION fixture_fail_transfer_audit()',
  );
  try {
    await expect(authorize()).rejects.toThrow('fixture audit failure');
  } finally {
    await db.pool.query('DROP TRIGGER fixture_transfer_audit ON audit');
    await db.pool.query('DROP FUNCTION fixture_fail_transfer_audit()');
  }
  expect((await db.pool.query('SELECT * FROM driver_transfer_operations')).rowCount).toBe(0);
  expect(await balances()).toMatchObject({ driver_payable: -790 });
  expect((await db.pool.query('SELECT * FROM outbox')).rowCount).toBe(0);
});
test('amount, binding, first-attempt time and known provider identity cannot be rewritten', async () => {
  const a = await authorize();
  await run(a.id);
  for (const sql of [
    'amount_cents=601',
    "account_id='acct_other'",
    'first_attempt_at=now()',
    "provider_transfer_id='tr_other'",
    "policy_reference='changed'",
  ])
    await expect(
      db.pool.query(`UPDATE driver_transfer_operations SET ${sql} WHERE id=$1`, [a.id]),
    ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.pool.query('DELETE FROM driver_transfer_operations WHERE id=$1', [a.id]),
  ).rejects.toMatchObject({ code: '23514' });
});
test('sweep recovers dead-lettered operations and confirmed transfers without unbounded repeated enqueueing', async () => {
  const a = await authorize();
  await run(a.id);
  reverse(a.id);
  await db.pool.query('UPDATE outbox SET completed_at=now()');
  expect(await service.sweep()).toBe(1);
  expect(await service.sweep()).toBe(0);
  const worker = new OutboxWorker(db.pool, { 'transfer.execute': service.handle });
  expect(await worker.runOnce()).toEqual({ processed: 1, failed: 0 });
  expect((await op(a.id)).reversed_cents).toBe(100);
});
test('reserved earnings cannot also be assigned to driver refund losses', async () => {
  await authorize();
  await transaction(db.pool, async (c) => {
    const id = randomUUID();
    await c.query(
      "INSERT INTO ledger_journals(id,key,fingerprint,attempt_id,ride_id,kind) VALUES($1::uuid,$1::text,'fixture',$2,$3,'refund_balance')",
      [id, attemptId, rideId],
    );
    await c.query(
      "INSERT INTO ledger_postings(journal_id,account,amount_cents) VALUES($1,'refund_suspense',200),($1,'stripe_clearing',-200)",
      [id],
    );
  });
  const losses = new PaymentLosses(db.pool, source, () => now);
  await expect(
    losses.allocate(
      staff,
      rideId,
      {
        kind: 'refund',
        expectedBalanceCents: 200,
        riderFundsCents: 0,
        driverCents: 200,
        platformCents: 0,
        policyReference: 'fixture',
      },
      'loss-over-reserved',
    ),
  ).rejects.toBeDefined();
  expect(await balances()).toMatchObject({
    driver_payable: -190,
    driver_transfer_pending: -600,
    refund_suspense: 200,
  });
});

test('an operation row without a matching ledger reservation cannot mutate or release money', async () => {
  const binding = (await db.pool.query('SELECT * FROM driver_payout_accounts WHERE driver_id=$1', [driverId]))
    .rows[0];
  const id = (
    await db.pool.query(
      `INSERT INTO driver_transfer_operations(attempt_id,driver_id,payout_binding_id,account_id,authorized_by,amount_cents,policy_reference)
    VALUES($1,$2,$3,$4,$5,600,'fixture-orphan') RETURNING id`,
      [attemptId, driverId, binding.id, binding.account_id, staff.id],
    )
  ).rows[0].id;
  await expect(run(id)).rejects.toMatchObject({ code: 'TRANSFER_REVIEW_REQUIRED' });
  await expect(service.cancel(staff, rideId, id, 'cancel-orphan')).rejects.toMatchObject({
    code: 'TRANSFER_REVIEW_REQUIRED',
  });
  expect(create).not.toHaveBeenCalled();
  expect(await balances()).toMatchObject({ driver_payable: -790 });
});
test('a provider balance transaction cannot be reused by a second operation', async () => {
  const first = await authorize();
  await run(first.id);
  const old = observed.get(first.id)!;
  const second = await authorize('second-transfer', 100);
  create.mockImplementationOnce(async (r: DriverTransferReference) => {
    const result = reference(r);
    result.movements[0]!.id = old.movements[0]!.id;
    return result;
  });
  await expect(run(second.id)).rejects.toMatchObject({ code: 'TRANSFER_REVIEW_REQUIRED' });
  expect((await db.pool.query('SELECT * FROM driver_transfer_movements')).rowCount).toBe(1);
  expect(await balances()).toMatchObject({
    driver_payable: -90,
    driver_transfer_pending: -100,
    stripe_clearing: 448,
  });
});

test('failed confirmation audit retains the reservation and recovers the already-created transfer once', async () => {
  const a = await authorize();
  await db.pool.query(
    "CREATE FUNCTION fixture_fail_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='driver_transfer.verified' THEN RAISE EXCEPTION 'fixture confirmation failure'; END IF; RETURN NEW; END $$",
  );
  await db.pool.query(
    'CREATE TRIGGER fixture_confirmation BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION fixture_fail_confirmation()',
  );
  try {
    await expect(run(a.id)).rejects.toThrow('fixture confirmation failure');
  } finally {
    await db.pool.query('DROP TRIGGER fixture_confirmation ON audit');
    await db.pool.query('DROP FUNCTION fixture_fail_confirmation()');
  }
  expect((await op(a.id)).provider_transfer_id).toBeNull();
  expect((await db.pool.query('SELECT * FROM driver_transfer_movements')).rowCount).toBe(0);
  expect(await balances()).toMatchObject({ driver_transfer_pending: -600, stripe_clearing: 1050 });
  await run(a.id);
  expect(create).toHaveBeenCalledTimes(1);
  expect((await op(a.id)).state).toBe('confirmed');
  expect(await balances()).toMatchObject({ driver_transfer_pending: 0, stripe_clearing: 448 });
});
test('refund authorization respects a pending transfer and becomes available after pre-attempt cancellation', async () => {
  const a = await authorize();
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'payments.refund')", [
    staff.id,
  ]);
  const provider = { refund: vi.fn() };
  const refunds = new RefundOperations(
    db.pool,
    provider,
    new RefundReconciler(db.pool, { refunds: vi.fn() }, source, () => now, true),
    source,
    () => now,
  );
  const input = { amountCents: 100, reason: 'customer_request', policyReference: 'fixture-approved-policy' };
  await expect(refunds.authorize(staff, rideId, input, 'refund-during-transfer')).rejects.toMatchObject({
    code: 'REFUND_REVIEW_REQUIRED',
  });
  await service.cancel(staff, rideId, a.id, 'cancel-for-refund');
  expect((await refunds.authorize(staff, rideId, input, 'refund-after-cancel')).state).toBe('queued');
  expect(provider.refund).not.toHaveBeenCalled();
});
