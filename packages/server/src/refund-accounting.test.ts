import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { transaction } from './transactions';
import { recordCapturedFunds } from './ledger';
import { recordRefundBalances } from './refund-accounting';
import type { RefundSnapshot } from './payment-provider';
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

function refunded(kind: 'refund' | 'refund_failure' = 'refund'): RefundSnapshot {
  return {
    id: 're_fixture',
    intentId: 'pi_fixture',
    amountCents: 300,
    status: kind === 'refund' ? 'pending' : 'failed',
    created: 1700000000,
    balanceTransactions: [
      {
        id: 'txn_refund',
        refundId: 're_fixture',
        kind: 'refund',
        amountCents: -300,
        feeCents: 5,
        netCents: -305,
      },
      ...(kind === 'refund_failure'
        ? [
            {
              id: 'txn_failure',
              refundId: 're_fixture',
              kind: 'refund_failure' as const,
              amountCents: 300,
              feeCents: -5,
              netCents: 305,
            },
          ]
        : []),
    ],
  };
}
async function record(refunds: RefundSnapshot[] = [refunded()]) {
  return transaction(database.pool, (c) =>
    recordRefundBalances(c, {
      source: 'acct_fixture:test',
      attemptId: input.attemptId,
      rideId: input.rideId,
      receivedCents: 1050,
      refunds,
    }),
  );
}
async function totals() {
  return (
    await database.pool.query(
      'SELECT account,sum(amount_cents)::int AS total FROM ledger_postings GROUP BY account ORDER BY account',
    )
  ).rows;
}
test('pending processor balance movement journals net, fee and suspense exactly once without debiting driver earnings', async () => {
  await transaction(database.pool, (c) => recordCapturedFunds(c, input));
  await Promise.all([record(), record()]);
  expect(await totals()).toEqual([
    { account: 'driver_payable', total: -790 },
    { account: 'platform_revenue', total: -260 },
    { account: 'processor_fees', total: 5 },
    { account: 'refund_suspense', total: 300 },
    { account: 'rider_funds', total: 0 },
    { account: 'stripe_clearing', total: 745 },
  ]);
  expect(
    (await database.pool.query("SELECT * FROM ledger_journals WHERE kind='refund_balance'")).rowCount,
  ).toBe(1);
});
test('verified failure balance returns funds with a new immutable compensating journal', async () => {
  await transaction(database.pool, (c) => recordCapturedFunds(c, input));
  await record();
  await record([refunded('refund_failure')]);
  await record([refunded('refund_failure')]);
  expect(await totals()).toContainEqual({ account: 'stripe_clearing', total: 1050 });
  expect(await totals()).toContainEqual({ account: 'refund_suspense', total: 0 });
  expect(await totals()).toContainEqual({ account: 'processor_fees', total: 0 });
  expect(
    (
      await database.pool.query(
        "SELECT * FROM ledger_journals WHERE kind IN ('refund_balance','refund_failure')",
      )
    ).rowCount,
  ).toBe(2);
});
test('status-only success, missing capture, changed transactions and duplicate financial references fail closed', async () => {
  await expect(record()).rejects.toMatchObject({ code: 'REFUND_ACCOUNTING_REVIEW' });
  await transaction(database.pool, (c) => recordCapturedFunds(c, input));
  await expect(record([{ ...refunded(), status: 'succeeded', balanceTransactions: [] }])).rejects.toThrow();
  await record();
  const changed = refunded();
  changed.balanceTransactions![0]!.feeCents = 6;
  changed.balanceTransactions![0]!.netCents = -306;
  await expect(record([changed])).rejects.toMatchObject({ code: 'REFUND_ACCOUNTING_REVIEW' });
  await expect(record([refunded(), refunded()])).rejects.toThrow();
  expect(
    (await database.pool.query("SELECT * FROM ledger_journals WHERE kind='refund_balance'")).rowCount,
  ).toBe(1);
});
test('failure status alone does not invent the processor balance reversal', async () => {
  await transaction(database.pool, (c) => recordCapturedFunds(c, input));
  await record([{ ...refunded(), status: 'failed' }]);
  expect(await totals()).toContainEqual({ account: 'stripe_clearing', total: 745 });
});
