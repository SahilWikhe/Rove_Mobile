import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { transaction } from './transactions';
import { recordCapturedFunds } from './ledger';
import { PaymentLosses } from './payment-losses';
import type { Actor } from './rides';
let staff: Actor;
let service: PaymentLosses;
const now = new Date('2026-09-12T20:00:00Z');
let database: Awaited<ReturnType<typeof testDatabase>>;
let input: Parameters<typeof recordCapturedFunds>[1];
beforeAll(async () => {
  database = await testDatabase();
}, 60000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  const rider = randomUUID();
  const driver = randomUUID();
  const quote = randomUUID();
  const ride = randomUUID();
  const attempt = randomUUID();
  const binding = randomUUID();
  for (const [id, role] of [
    [rider, 'rider'],
    [driver, 'driver'],
  ])
    await database.pool.query(
      "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Fixture',$2)",
      [id, role],
    );
  await database.pool.query('INSERT INTO drivers(id) VALUES($1)', [driver]);
  await database.pool.query(
    "INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now()+interval '1 minute')",
    [quote, rider],
  );
  await database.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,driver_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,$4,'completed',1050,790,now())",
    [ride, quote, rider, driver],
  );
  await database.pool.query(
    "INSERT INTO payment_customers(id,rider_id,source,customer_id) VALUES($1,$2,'acct_fixture:test','cus_fixture')",
    [binding, rider],
  );
  await database.pool.query(
    "INSERT INTO payment_attempts(id,ride_id,customer_binding_id,intent_id,source,amount_cents) VALUES($1,$2,$3,'pi_fixture','acct_fixture:test',1050)",
    [attempt, ride, binding],
  );
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  await database.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Fixture staff','staff')",
    [staff.id],
  );
  await database.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'payments.loss.allocate')",
    [staff.id],
  );
  await database.pool.query('INSERT INTO payment_refund_checks(attempt_id,verified_at) VALUES($1,$2)', [
    attempt,
    now,
  ]);
  await database.pool.query('INSERT INTO payment_dispute_checks(attempt_id,verified_at) VALUES($1,$2)', [
    attempt,
    now,
  ]);
  service = new PaymentLosses(database.pool, 'acct_fixture:test', () => now);
  input = {
    attemptId: attempt,
    rideId: ride,
    riderId: rider,
    driverId: driver,
    receivedCents: 1050,
    earningsCents: 790,
    completed: true,
    fullFare: true,
  };
});
const allocation = (amount = 300, driver = 200) => ({
  kind: 'refund' as const,
  expectedBalanceCents: amount,
  riderFundsCents: 0,
  driverCents: driver,
  platformCents: amount - driver,
  policyReference: 'fixture-approved-policy-v1',
});
async function movement(amount = 300, kind = 'refund') {
  await transaction(database.pool, async (c) => {
    const id = randomUUID();
    await c.query(
      `INSERT INTO ledger_journals(id,key,fingerprint,attempt_id,ride_id,kind) VALUES($1::uuid,$1::text,'fixture',$2,$3,$4)`,
      [id, input.attemptId, input.rideId, `${kind}_balance`],
    );
    await c.query(
      `INSERT INTO ledger_postings(journal_id,account,amount_cents) VALUES($1,$2,$3),($1,'stripe_clearing',$4)`,
      [id, `${kind}_suspense`, amount, -amount],
    );
  });
}
async function capture(completed = true) {
  await transaction(database.pool, (c) => recordCapturedFunds(c, { ...input, completed }));
}
async function balances() {
  return Object.fromEntries(
    (
      await database.pool.query(
        `SELECT account,sum(amount_cents)::int AS amount FROM ledger_postings GROUP BY account`,
      )
    ).rows.map((r) => [r.account, r.amount]),
  );
}
test('authorized split resolves suspense without rewriting captured fare or original driver earnings', async () => {
  await capture();
  await movement();
  const before = (
    await database.pool.query(
      "SELECT j.id,l.amount_cents FROM ledger_journals j JOIN ledger_postings l ON l.journal_id=j.id WHERE j.kind='allocation' AND l.account='driver_payable'",
    )
  ).rows[0];
  const result = await service.allocate(staff, input.rideId, allocation(), 'allocation-one');
  expect(await balances()).toMatchObject({
    driver_payable: -590,
    platform_revenue: -260,
    platform_payment_losses: 100,
    refund_suspense: 0,
    stripe_clearing: 750,
  });
  expect(
    (
      await database.pool.query(
        "SELECT j.id,l.amount_cents FROM ledger_journals j JOIN ledger_postings l ON l.journal_id=j.id WHERE j.kind='allocation' AND l.account='driver_payable'",
      )
    ).rows[0],
  ).toEqual(before);
  expect((await database.pool.query('SELECT * FROM payment_loss_allocations')).rows).toMatchObject([
    { id: result.id, authorized_by: staff.id, policy_reference: 'fixture-approved-policy-v1' },
  ]);
  expect(
    (
      await database.pool.query(
        "SELECT * FROM audit WHERE action='staff.payment_loss_allocated' AND aggregate_id=$1",
        [result.id],
      )
    ).rowCount,
  ).toBe(1);
  expect(await service.status(staff, input.rideId)).toMatchObject({
    refundBalanceCents: 0,
    driverPayableCents: 590,
    verifiedRecordsCurrent: true,
    allocatedLosses: [
      { kind: 'refund', riderFundsCents: 0, driverCents: 200, platformCents: 100 },
      { kind: 'dispute', riderFundsCents: 0, driverCents: 0, platformCents: 0 },
    ],
  });
});
test('simultaneous staff decisions cannot allocate the same loss twice; retry returns the original result', async () => {
  await capture();
  await movement();
  const results = await Promise.allSettled([
    service.allocate(staff, input.rideId, allocation(), 'concurrent-one'),
    service.allocate(staff, input.rideId, allocation(), 'concurrent-two'),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  expect((await database.pool.query('SELECT * FROM payment_loss_allocations')).rowCount).toBe(1);
  const key = results[0]!.status === 'fulfilled' ? 'concurrent-one' : 'concurrent-two';
  await service.allocate(staff, input.rideId, allocation(), key);
  await expect(service.allocate(staff, input.rideId, allocation(300, 100), key)).rejects.toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  expect((await database.pool.query('SELECT * FROM payment_loss_allocations')).rowCount).toBe(1);
});
test('a driver deduction cannot exceed remaining payable or consume another loss category twice', async () => {
  await capture();
  await movement(900);
  await expect(
    service.allocate(staff, input.rideId, allocation(900, 800), 'over-driver'),
  ).rejects.toMatchObject({ code: 'LOSS_REVIEW_REQUIRED' });
  await service.allocate(staff, input.rideId, allocation(900, 700), 'first-charge');
  await movement(200, 'dispute');
  await expect(
    service.allocate(staff, input.rideId, { ...allocation(200, 100), kind: 'dispute' }, 'over-after-refund'),
  ).rejects.toMatchObject({ code: 'LOSS_REVIEW_REQUIRED' });
  await service.allocate(staff, input.rideId, { ...allocation(200, 90), kind: 'dispute' }, 'dispute-charge');
  expect(await balances()).toMatchObject({ driver_payable: 0, refund_suspense: 0, dispute_suspense: 0 });
});
test('verified return restores only the same party’s prior deduction for that loss category', async () => {
  await capture();
  await movement();
  await service.allocate(staff, input.rideId, allocation(), 'initial-charge');
  await movement(-300);
  await expect(
    service.allocate(staff, input.rideId, allocation(-300, -300), 'wrong-restore'),
  ).rejects.toMatchObject({ code: 'LOSS_REVIEW_REQUIRED' });
  await service.allocate(staff, input.rideId, allocation(-300, -200), 'correct-restore');
  expect(await balances()).toMatchObject({
    driver_payable: -790,
    platform_payment_losses: 0,
    refund_suspense: 0,
    stripe_clearing: 1050,
  });
  await movement(-100, 'dispute');
  await expect(
    service.allocate(staff, input.rideId, { ...allocation(-100, -100), kind: 'dispute' }, 'other-kind'),
  ).rejects.toMatchObject({ code: 'LOSS_REVIEW_REQUIRED' });
});
test('released rider funds cannot later be allocated again as full-fare earnings', async () => {
  await capture(false);
  await movement();
  await service.allocate(
    staff,
    input.rideId,
    { ...allocation(300, 0), riderFundsCents: 300, platformCents: 0 },
    'release-rider',
  );
  expect(await transaction(database.pool, (c) => recordCapturedFunds(c, input))).toBe(false);
  expect(await balances()).toMatchObject({ rider_funds: -750, refund_suspense: 0 });
  expect((await database.pool.query("SELECT * FROM ledger_journals WHERE kind='allocation'")).rowCount).toBe(
    0,
  );
});
test('unknown/stale provider records and changed balances require refreshed review', async () => {
  await capture();
  await movement();
  await database.pool.query('UPDATE payment_dispute_checks SET verified_at=NULL');
  expect(await service.status(staff, input.rideId)).toMatchObject({ verifiedRecordsCurrent: false });
  await expect(service.allocate(staff, input.rideId, allocation(), 'missing-facts')).rejects.toMatchObject({
    code: 'LOSS_REVIEW_REQUIRED',
  });
  await database.pool.query('UPDATE payment_dispute_checks SET verified_at=$1', [
    new Date(now.getTime() - 300001),
  ]);
  await expect(service.allocate(staff, input.rideId, allocation(), 'stale-facts')).rejects.toMatchObject({
    code: 'LOSS_REVIEW_REQUIRED',
  });
  await database.pool.query('UPDATE payment_dispute_checks SET verified_at=$1', [now]);
  await movement(100);
  await expect(service.allocate(staff, input.rideId, allocation(), 'stale-amount')).rejects.toMatchObject({
    code: 'LOSS_REVIEW_REQUIRED',
  });
});
test('MFA, explicit permission, source ownership and replay authorization remain enforced', async () => {
  await capture();
  await movement();
  await expect(
    service.allocate({ ...staff, mfa: false }, input.rideId, allocation(), 'no-mfa-key'),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(service.status({ id: input.riderId, role: 'rider' }, input.rideId)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(
    new PaymentLosses(database.pool, 'acct_other:test', () => now).allocate(
      staff,
      input.rideId,
      allocation(),
      'other-source',
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await service.allocate(staff, input.rideId, allocation(), 'authorized-key');
  await database.pool.query('DELETE FROM staff_permissions');
  await expect(service.allocate(staff, input.rideId, allocation(), 'authorized-key')).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
test('decisions and postings are immutable and malformed mixed-direction allocations are rejected', async () => {
  await capture();
  await movement();
  await expect(
    service.allocate(
      staff,
      input.rideId,
      { ...allocation(), driverCents: -100, platformCents: 400 },
      'mixed-signs',
    ),
  ).rejects.toThrow();
  await service.allocate(staff, input.rideId, allocation(), 'immutable-key');
  for (const sql of [
    "UPDATE payment_loss_allocations SET policy_reference='changed'",
    'DELETE FROM payment_loss_allocations',
    "DELETE FROM ledger_postings WHERE account='platform_payment_losses'",
  ])
    await expect(database.pool.query(sql)).rejects.toMatchObject({ code: '23514' });
});

test('an audit persistence failure rolls back the decision, command result and financial postings', async () => {
  await capture();
  await movement();
  await database.pool
    .query(`CREATE FUNCTION fixture_reject_loss_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='staff.payment_loss_allocated' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER fixture_loss_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION fixture_reject_loss_audit();`);
  try {
    await expect(service.allocate(staff, input.rideId, allocation(), 'audit-retry-key')).rejects.toThrow(
      'fixture audit unavailable',
    );
    expect((await database.pool.query('SELECT * FROM payment_loss_allocations')).rowCount).toBe(0);
    expect(
      (await database.pool.query("SELECT * FROM ledger_journals WHERE kind='refund_loss_allocation'"))
        .rowCount,
    ).toBe(0);
    expect(await balances()).toMatchObject({ driver_payable: -790, refund_suspense: 300 });
  } finally {
    await database.pool.query(
      'DROP TRIGGER fixture_loss_audit ON audit; DROP FUNCTION fixture_reject_loss_audit()',
    );
  }
  await service.allocate(staff, input.rideId, allocation(), 'audit-retry-key');
  expect((await database.pool.query('SELECT * FROM payment_loss_allocations')).rowCount).toBe(1);
});
