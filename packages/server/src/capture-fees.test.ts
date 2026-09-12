import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import type { PaymentReference } from './payment-provider';
import type { CaptureBalanceSnapshot, CaptureBalanceProvider } from './capture-balance-provider';
import { CaptureFees } from './capture-fees';
import { recordCapturedFunds } from './ledger';
import { transaction } from './transactions';
let database: Awaited<ReturnType<typeof testDatabase>>;
let reference: PaymentReference;
let now: Date;
let service: CaptureFees;
let driver: string;
const source = 'acct_fixture:test';
const retrieve = vi.fn<CaptureBalanceProvider['retrieve']>();
const snapshot = (): CaptureBalanceSnapshot => ({
  chargeId: 'ch_fixture',
  balanceId: 'txn_fixture',
  amountCents: 1050,
  feeCents: 61,
  netCents: 989,
  status: 'available',
  disputed: false,
  unrefundedCents: 1050,
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

  driver = randomUUID();
  await database.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Fixture driver','driver')",
    [driver],
  );
  await database.pool.query('INSERT INTO drivers(id) VALUES($1)', [driver]);
  await database.pool.query("UPDATE rides SET driver_id=$2,state='completed' WHERE id=$1", [
    reference.rideId,
    driver,
  ]);
  await transaction(database.pool, (c) =>
    recordCapturedFunds(c, {
      attemptId: reference.attemptId,
      rideId: reference.rideId,
      riderId: rider,
      receivedCents: 1050,
      driverId: driver,
      earningsCents: 790,
      completed: true,
      fullFare: true,
    }),
  );
  retrieve.mockReset();
  retrieve.mockImplementation(async () => snapshot());
  service = new CaptureFees(database.pool, { retrieve }, source, () => now);
});
const reconcile = () => service.reconcile(reference.intentId);
const ready = () => transaction(database.pool, (c) => service.assertReady(c, reference.attemptId, 1050));
async function stored() {
  return (
    await database.pool.query('SELECT * FROM payment_capture_checks WHERE attempt_id=$1', [
      reference.attemptId,
    ])
  ).rows[0];
}
async function balances() {
  return Object.fromEntries(
    (
      await database.pool.query(
        'SELECT account,sum(amount_cents)::int AS amount FROM ledger_postings GROUP BY account',
      )
    ).rows.map((r) => [r.account, r.amount]),
  );
}
test('books the actual fee once while preserving driver earnings and gross capture', async () => {
  await expect(ready()).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_REVIEW' });
  await reconcile();
  await reconcile();
  expect(await balances()).toMatchObject({
    stripe_clearing: 989,
    processor_fees: 61,
    driver_payable: -790,
    platform_revenue: -260,
    rider_funds: 0,
  });
  expect(await ready()).toEqual({ chargeId: 'ch_fixture' });
  expect((await database.pool.query("SELECT * FROM ledger_journals WHERE kind='capture_fee'")).rowCount).toBe(
    1,
  );
  expect(
    (await database.pool.query("SELECT * FROM audit WHERE action='capture.fee_verified'")).rowCount,
  ).toBe(1);
  expect((await stored()).fee_cents).toBe(61);
});
test('explicit zero fee has a durable verified binding and no zero-value journal', async () => {
  retrieve.mockResolvedValue({ ...snapshot(), feeCents: 0, netCents: 1050 });
  await reconcile();
  await reconcile();
  expect((await stored()).journal_id).toBeNull();
  expect((await stored()).fee_cents).toBe(0);
  expect(await ready()).toEqual({ chargeId: 'ch_fixture' });
  expect((await database.pool.query("SELECT * FROM ledger_journals WHERE kind='capture_fee'")).rowCount).toBe(
    0,
  );
});
test('pending capture balances hold settlement until available', async () => {
  retrieve.mockResolvedValueOnce({ ...snapshot(), status: 'pending' });
  await expect(reconcile()).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_REVIEW' });
  expect((await stored()).balance_id).toBeNull();
  await expect(ready()).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_REVIEW' });
  expect((await balances()).stripe_clearing).toBe(1050);
  await reconcile();
  expect(await ready()).toEqual({ chargeId: 'ch_fixture' });
});
test('later refunds and disputes do not rewrite original fee accounting', async () => {
  await reconcile();
  retrieve.mockResolvedValue({ ...snapshot(), disputed: true, unrefundedCents: 100 });
  await reconcile();
  expect((await balances()).processor_fees).toBe(61);
});
test.each([
  { feeCents: 62, netCents: 988 },
  { balanceId: 'txn_other' },
  { chargeId: 'ch_other' },
  { status: 'pending' as const },
])('changed settled facts retain original journal and create a durable review hold %j', async (change) => {
  await reconcile();
  retrieve.mockResolvedValue({ ...snapshot(), ...change });
  await expect(reconcile()).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_REVIEW' });
  expect((await stored()).review_required).toBe(true);
  expect((await balances()).processor_fees).toBe(61);
  retrieve.mockResolvedValue(snapshot());
  await expect(reconcile()).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_REVIEW' });
  await expect(ready()).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_REVIEW' });
});
test('stale reads cannot overwrite a newer available observation', async () => {
  let release!: (s: CaptureBalanceSnapshot) => void;
  let started!: () => void;
  const called = new Promise<void>((r) => {
    started = r;
  });
  retrieve.mockImplementationOnce(
    () =>
      new Promise((r) => {
        release = r;
        started();
      }),
  );
  const older = reconcile();
  await called;
  await reconcile();
  release({ ...snapshot(), status: 'pending' });
  await expect(older).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_RETRY' });
  expect((await stored()).review_required).toBe(false);
  expect(await ready()).toEqual({ chargeId: 'ch_fixture' });
});
test('freshness is required and future timestamps are not accepted', async () => {
  await reconcile();
  now = new Date(now.getTime() + 300001);
  await expect(ready()).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_REVIEW' });
  await reconcile();
  expect(await ready()).toEqual({ chargeId: 'ch_fixture' });
  now = new Date(now.getTime() - 11000);
  await expect(ready()).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_REVIEW' });
});
test('invalid arithmetic and wrong amount cannot create a verified record', async () => {
  for (const change of [
    { netCents: 988 },
    { amountCents: 1049, netCents: 988 },
    { feeCents: -1, netCents: 1051 },
  ]) {
    retrieve.mockResolvedValue({ ...snapshot(), ...change });
    await expect(reconcile()).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_REVIEW' });
  }
  expect((await balances()).stripe_clearing).toBe(1050);
  await expect(ready()).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_REVIEW' });
});
test('source isolation rejects another account without contacting the provider', async () => {
  const other = new CaptureFees(database.pool, { retrieve }, 'acct_other:test', () => now);
  await expect(other.reconcile(reference.intentId)).rejects.toMatchObject({
    code: 'CAPTURE_ACCOUNTING_REVIEW',
  });
  expect(retrieve).not.toHaveBeenCalled();
});
test('journal and binding roll back together if the audit insert fails', async () => {
  await database.pool.query(
    "CREATE FUNCTION fixture_capture_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$",
  );
  await database.pool.query(
    'CREATE TRIGGER fixture_capture_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION fixture_capture_audit_failure()',
  );
  try {
    await expect(reconcile()).rejects.toThrow('fixture audit failure');
  } finally {
    await database.pool.query('DROP TRIGGER fixture_capture_audit ON audit');
    await database.pool.query('DROP FUNCTION fixture_capture_audit_failure()');
  }
  expect((await balances()).stripe_clearing).toBe(1050);
  expect((await stored()).balance_id).toBeNull();
  await reconcile();
  expect((await balances()).stripe_clearing).toBe(989);
});
test('verified binding and review hold cannot be rewritten or deleted', async () => {
  await reconcile();
  for (const assignment of [
    "balance_id='txn_other'",
    'fee_cents=62,net_cents=988',
    "source='acct_other:test'",
    'revision=0',
  ])
    await expect(
      database.pool.query(`UPDATE payment_capture_checks SET ${assignment}`),
    ).rejects.toMatchObject({ code: '23514' });
  await expect(database.pool.query('DELETE FROM payment_capture_checks')).rejects.toMatchObject({
    code: '23514',
  });
  await database.pool.query('UPDATE payment_capture_checks SET review_required=true');
  await expect(
    database.pool.query('UPDATE payment_capture_checks SET review_required=false'),
  ).rejects.toMatchObject({ code: '23514' });
});
test('recovery sweep is bounded per payment per hour and excludes review holds', async () => {
  expect(await service.sweep()).toBe(1);
  expect(await service.sweep()).toBe(0);
  const job = (await database.pool.query("SELECT * FROM outbox WHERE topic='capture-fee.reconcile'")).rows[0];
  await service.handle(job);
  expect(await ready()).toEqual({ chargeId: 'ch_fixture' });
  now = new Date(now.getTime() + 3600001);
  expect(await service.sweep()).toBe(1);
  await database.pool.query('UPDATE payment_capture_checks SET review_required=true');
  now = new Date(now.getTime() + 3600001);
  expect(await service.sweep()).toBe(0);
});

test('one provider balance cannot be claimed by two payments, including zero-fee captures', async () => {
  retrieve.mockResolvedValue({ ...snapshot(), feeCents: 0, netCents: 1050 });
  await reconcile();
  const prior = (
    await database.pool.query(
      'SELECT p.customer_binding_id,r.rider_id FROM payment_attempts p JOIN rides r ON r.id=p.ride_id WHERE p.id=$1',
      [reference.attemptId],
    )
  ).rows[0];
  const quote = randomUUID(),
    ride = randomUUID(),
    attempt = randomUUID();
  await database.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
    quote,
    prior.rider_id,
  ]);
  await database.pool.query(
    'INSERT INTO rides(id,quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,1050,790,now())',
    [ride, quote, prior.rider_id],
  );
  await database.pool.query(
    "INSERT INTO payment_attempts(id,ride_id,customer_binding_id,intent_id,source,amount_cents) VALUES($1,$2,$3,'pi_other',$4,1050)",
    [attempt, ride, prior.customer_binding_id, source],
  );
  await transaction(database.pool, (c) =>
    recordCapturedFunds(c, {
      attemptId: attempt,
      rideId: ride,
      riderId: prior.rider_id,
      receivedCents: 1050,
      driverId: null,
      earningsCents: 790,
      completed: false,
      fullFare: true,
    }),
  );
  await expect(service.reconcile('pi_other')).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_REVIEW' });
  expect(
    (await database.pool.query('SELECT * FROM payment_capture_checks WHERE balance_id IS NOT NULL')).rowCount,
  ).toBe(1);
  await expect(
    transaction(database.pool, (c) => service.assertReady(c, attempt, 1050)),
  ).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_REVIEW' });
});

test('a paid status without the original gross ledger capture cannot book fees', async () => {
  const attempt = randomUUID(),
    quote = randomUUID(),
    ride = randomUUID();
  const original = (
    await database.pool.query(
      'SELECT p.customer_binding_id,r.rider_id FROM payment_attempts p JOIN rides r ON r.id=p.ride_id WHERE p.id=$1',
      [reference.attemptId],
    )
  ).rows[0];
  await database.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
    quote,
    original.rider_id,
  ]);
  await database.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,fare_cents,earnings_cents,search_deadline,payment_state) VALUES($1,$2,$3,1050,790,now(),'paid')",
    [ride, quote, original.rider_id],
  );
  await database.pool.query(
    "INSERT INTO payment_attempts(id,ride_id,customer_binding_id,intent_id,source,amount_cents) VALUES($1,$2,$3,'pi_other',$4,1050)",
    [attempt, ride, original.customer_binding_id, source],
  );
  await expect(service.reconcile('pi_other')).rejects.toMatchObject({ code: 'CAPTURE_ACCOUNTING_REVIEW' });
  expect(retrieve).not.toHaveBeenCalled();
});
