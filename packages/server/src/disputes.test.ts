import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import type { PaymentReference } from './payment-provider';
import { DisputeReconciler, type DisputeProvider, type DisputeSnapshot } from './disputes';
import type { Actor } from './rides';
let staff: Actor;
import { recordCapturedFunds } from './ledger';
import { transaction } from './transactions';
let database: Awaited<ReturnType<typeof testDatabase>>;
let reference: PaymentReference;
let now: Date;
let reconcile: DisputeReconciler;
const source = 'acct_fixture:test';
const disputes = vi.fn<DisputeProvider['disputes']>();
function snapshot(items: DisputeSnapshot[] = []) {
  return {
    payment: { ...reference, status: 'succeeded' as const, capturableCents: 0, receivedCents: 1050 },
    disputes: items,
  };
}
const item = (status: DisputeSnapshot['status'] = 'needs_response'): DisputeSnapshot => ({
  id: 'du_fixture',
  intentId: reference.intentId,
  amountCents: 1050,
  status,
  reason: 'general',
  created: 1700000000,
  dueBy: 1790000000,
  balanceTransactions: [],
});
const withdrawal = {
  id: 'txn_withdrawal',
  disputeId: 'du_fixture',
  amountCents: -1050,
  feeCents: 1500,
  netCents: -2550,
};
const reversal = {
  id: 'txn_reversal',
  disputeId: 'du_fixture',
  amountCents: 1050,
  feeCents: -1500,
  netCents: 2550,
};
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
  disputes.mockReset();
  disputes.mockImplementation(async () => snapshot());
  reconcile = new DisputeReconciler(database.pool, { disputes }, source, () => now);
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  await database.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Staff','staff')",
    [staff.id],
  );
  await database.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'payments.dispute.review')",
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
});

async function check() {
  return (
    await database.pool.query('SELECT * FROM payment_dispute_checks WHERE attempt_id=$1', [
      reference.attemptId,
    ])
  ).rows[0];
}
test('verified disputes preserve deductions and reversals as balanced immutable journals', async () => {
  disputes.mockResolvedValue(snapshot([{ ...item(), balanceTransactions: [withdrawal] }]));
  await reconcile.reconcile(reference.intentId);
  await reconcile.reconcile(reference.intentId);
  await expect(
    transaction(database.pool, (c) => reconcile.assertRefundable(c, reference.attemptId)),
  ).rejects.toMatchObject({ code: 'DISPUTE_PAYMENT_HOLD' });
  disputes.mockResolvedValue(snapshot([{ ...item('won'), balanceTransactions: [withdrawal, reversal] }]));
  await reconcile.reconcile(reference.intentId);
  await transaction(database.pool, (c) => reconcile.assertRefundable(c, reference.attemptId));
  const rows = (
    await database.pool.query(
      'SELECT account,sum(amount_cents)::int AS total FROM ledger_postings GROUP BY account',
    )
  ).rows;
  expect(rows).toContainEqual({ account: 'stripe_clearing', total: 1050 });
  expect(rows).toContainEqual({ account: 'dispute_suspense', total: 0 });
  expect(
    (await database.pool.query("SELECT * FROM ledger_journals WHERE kind='dispute_balance'")).rowCount,
  ).toBe(2);
  expect((await database.pool.query('SELECT * FROM payment_dispute_observations')).rowCount).toBe(2);
  await expect(database.pool.query('DELETE FROM payment_dispute_observations')).rejects.toThrow('immutable');
});
test('unknown, stale and won-but-unreturned balances remain blocked', async () => {
  await expect(
    transaction(database.pool, (c) => reconcile.assertRefundable(c, reference.attemptId)),
  ).rejects.toThrow();
  await reconcile.reconcile(reference.intentId);
  await transaction(database.pool, (c) => reconcile.assertRefundable(c, reference.attemptId));
  now = new Date(now.getTime() + 300001);
  await expect(
    transaction(database.pool, (c) => reconcile.assertRefundable(c, reference.attemptId)),
  ).rejects.toThrow();
  disputes.mockResolvedValue(snapshot([{ ...item('won'), balanceTransactions: [withdrawal] }]));
  await reconcile.reconcile(reference.intentId);
  await expect(
    transaction(database.pool, (c) => reconcile.assertRefundable(c, reference.attemptId)),
  ).rejects.toThrow();
});
test('mismatched references and disappearing financial facts never replace verified history', async () => {
  disputes.mockResolvedValue(snapshot([{ ...item(), balanceTransactions: [withdrawal] }]));
  await reconcile.reconcile(reference.intentId);
  const before = await check();
  for (const bad of [
    snapshot([]),
    snapshot([{ ...item(), intentId: 'pi_other' }]),
    snapshot([{ ...item(), balanceTransactions: [] }]),
    { ...snapshot([item()]), payment: { ...snapshot().payment, customerId: 'cus_other' } },
  ]) {
    disputes.mockResolvedValueOnce(bad);
    await expect(reconcile.reconcile(reference.intentId)).rejects.toThrow();
    expect(await check()).toEqual(before);
  }
});
test('older concurrent provider responses cannot overwrite newer observations', async () => {
  await reconcile.reconcile(reference.intentId);
  let started!: () => void;
  const begin = new Promise<void>((r) => (started = r));
  let finish!: (v: ReturnType<typeof snapshot>) => void;
  disputes
    .mockImplementationOnce(() => {
      started();
      return new Promise((r) => (finish = r));
    })
    .mockResolvedValueOnce(snapshot([item('won')]));
  const old = reconcile.reconcile(reference.intentId);
  const rejected = expect(old).rejects.toMatchObject({ code: 'DISPUTE_RETRY' });
  await begin;
  await reconcile.reconcile(reference.intentId);
  finish(snapshot([item()]));
  await rejected;
  expect((await check()).disputes[0].status).toBe('won');
});
test('ledger failure rolls back the observation and retries without duplicate financial movements', async () => {
  await reconcile.reconcile(reference.intentId);
  const before = await check();
  disputes.mockResolvedValue(snapshot([{ ...item(), balanceTransactions: [withdrawal] }]));
  await database.pool.query(
    "ALTER TABLE ledger_postings ADD CONSTRAINT fixture_dispute_failure CHECK(account<>'dispute_suspense') NOT VALID",
  );
  try {
    await expect(reconcile.reconcile(reference.intentId)).rejects.toThrow();
  } finally {
    await database.pool.query('ALTER TABLE ledger_postings DROP CONSTRAINT fixture_dispute_failure');
  }
  expect(await check()).toEqual(before);
  await reconcile.reconcile(reference.intentId);
  expect(
    (await database.pool.query("SELECT * FROM ledger_journals WHERE kind='dispute_balance'")).rowCount,
  ).toBe(1);
});
test('staff queue requires MFA and permission, filters status and paginates all records without raw evidence', async () => {
  const history = Array.from({ length: 53 }, (_, i) => ({
    ...item(),
    id: `du_case${String(i).padStart(3, '0')}`,
    dueBy: 1790000000 + i,
  }));
  disputes.mockResolvedValue(snapshot(history));
  await reconcile.reconcile(reference.intentId);
  await expect(reconcile.queue({ ...staff, mfa: false }, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const first = await reconcile.queue(staff, { status: 'needs_response' });
  expect(first.items).toHaveLength(50);
  expect(first.nextCursor).toBeTruthy();
  const next = await reconcile.queue(staff, { cursor: first.nextCursor!, status: 'needs_response' });
  expect(next.items).toHaveLength(3);
  expect(next.nextCursor).toBeNull();
  expect(new Set([...first.items, ...next.items].map((i) => i.id)).size).toBe(53);
  expect(JSON.stringify(first)).not.toContain('pi_fixture');
  expect(JSON.stringify(first)).not.toContain('balanceTransactions');
  expect((await reconcile.queue(staff, { status: 'won' })).items).toEqual([]);
  await expect(reconcile.queue(staff, { cursor: 'invalid' })).rejects.toMatchObject({
    code: 'INVALID_CURSOR',
  });
  await database.pool.query('DELETE FROM staff_permissions');
  await expect(reconcile.refresh(staff, reference.rideId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
test('source-scoped hourly recovery deduplicates queued checks', async () => {
  await database.pool.query("UPDATE rides SET payment_state='paid'");
  expect(await reconcile.sweep()).toBe(1);
  expect(await reconcile.sweep()).toBe(0);
  expect(
    (await database.pool.query("SELECT payload FROM outbox WHERE topic='dispute.reconcile'")).rows[0].payload,
  ).toEqual({ source, intentId: reference.intentId });
  await reconcile.reconcile(reference.intentId);
  now = new Date(now.getTime() + 3600001);
  expect(await reconcile.sweep()).toBe(1);
});
