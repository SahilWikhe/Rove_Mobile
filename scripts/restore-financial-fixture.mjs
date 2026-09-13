import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PaymentReconciler } from '../packages/server/src/payment-reconciliation.ts';
import { PaymentReviews } from '../packages/server/src/payment-review.ts';
import { getReceipt } from '../apps/api/src/receipt-queries.ts';
import { actorTransaction } from '../packages/server/src/actor-transaction.ts';
import { bindLedgerAttempt } from '../packages/server/src/ledger-scope.ts';

const source = 'acct_restorefixture:test';
export async function seedRestoreFinancialFixture(owner, runtime) {
  const rider = randomUUID(),
    driver = randomUUID(),
    staff = randomUUID();
  for (const [id, role] of [
    [rider, 'rider'],
    [driver, 'driver'],
    [staff, 'staff'],
  ])
    await owner.query('INSERT INTO users(id,subject,name,role) VALUES($1,$2,$3,$4)', [
      id,
      'synthetic-restore:' + id,
      'Synthetic restore ' + role,
      role,
    ]);
  await owner.query('INSERT INTO drivers(id) VALUES($1)', [driver]);
  await owner.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'payments.review')", [
    staff,
  ]);
  const quote = randomUUID(),
    ride = randomUUID(),
    attempt = randomUUID(),
    binding = randomUUID();
  await owner.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
    quote,
    rider,
  ]);
  await owner.query(
    "INSERT INTO rides(id,quote_id,rider_id,driver_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,$4,'completed',200,150,now())",
    [ride, quote, rider, driver],
  );
  await owner.query(
    "INSERT INTO payment_customers(id,rider_id,source,customer_id) VALUES($1,$2,$3,'cus_restorefixture')",
    [binding, rider, source],
  );
  await owner.query(
    "INSERT INTO payment_attempts(id,ride_id,customer_binding_id,source,amount_cents,intent_id) VALUES($1,$2,$3,$4,200,'pi_restorefixture')",
    [attempt, ride, binding, source],
  );
  const reference = {
    rideId: ride,
    attemptId: attempt,
    intentId: 'pi_restorefixture',
    customerId: 'cus_restorefixture',
    amountCents: 200,
  };
  const provider = {
    retrieve: async (received) => {
      assert.deepEqual(received, reference);
      return { ...reference, status: 'succeeded', receivedCents: 200, capturableCents: 0 };
    },
  };
  await new PaymentReconciler(runtime, provider, source).reconcile(reference.intentId);
  const job = {
    id: randomUUID(),
    topic: 'payment.review_required',
    aggregateId: ride,
    payload: { attemptId: attempt },
    attempt: 1,
  };
  await owner.query('INSERT INTO outbox(id,topic,aggregate_id,payload,dedupe_key) VALUES($1,$2,$3,$4,$5)', [
    job.id,
    job.topic,
    ride,
    JSON.stringify(job.payload),
    'restore-review:' + job.id,
  ]);
  await new PaymentReviews(runtime, source).handle(job);
  const receipt = await getReceipt(runtime, { id: rider, role: 'rider' }, ride);
  return { reference, provider, job, rider, driver, staff: { id: staff, role: 'staff', mfa: true }, receipt };
}
export async function changeFinancialSourceAfterBackup(runtime, fixture) {
  await new PaymentReviews(runtime, source).acknowledge(fixture.staff, fixture.job.id, {
    reference: 'synthetic:after-backup',
  });
}
export async function verifyRestoredFinancialFixture(owner, runtime, fixture, unrelatedRider) {
  const { reference, provider, job, rider, driver, staff, receipt } = fixture;
  const journalSnapshot = async () =>
    (
      await owner.query(
        'SELECT to_jsonb(j) AS record FROM ledger_journals j WHERE attempt_id=$1 ORDER BY id',
        [reference.attemptId],
      )
    ).rows;
  const before = await journalSnapshot();
  assert.equal(before.length, 2);
  assert.deepEqual(await getReceipt(runtime, { id: rider, role: 'rider' }, reference.rideId), receipt);
  await assert.rejects(getReceipt(runtime, { id: driver, role: 'driver' }, reference.rideId), {
    code: 'NOT_FOUND',
  });
  await assert.rejects(getReceipt(runtime, { id: unrelatedRider, role: 'rider' }, reference.rideId), {
    code: 'NOT_FOUND',
  });
  const sums = (
    await owner.query(
      'SELECT j.kind,sum(p.amount_cents)::int AS balance FROM ledger_journals j JOIN ledger_postings p ON p.journal_id=j.id WHERE j.attempt_id=$1 GROUP BY j.kind ORDER BY j.kind',
      [reference.attemptId],
    )
  ).rows;
  assert.deepEqual(sums, [
    { kind: 'allocation', balance: 0 },
    { kind: 'capture', balance: 0 },
  ]);
  await new PaymentReconciler(runtime, provider, source).reconcile(reference.intentId);
  assert.deepEqual(await journalSnapshot(), before);
  await actorTransaction(runtime, { id: rider, role: 'rider' }, async (c) => {
    await bindLedgerAttempt(c, reference.attemptId);
    assert.equal(
      (await c.query('DELETE FROM ledger_journals WHERE attempt_id=$1', [reference.attemptId])).rowCount,
      0,
    );
  });
  const reviews = new PaymentReviews(runtime, source);
  const queue = await reviews.queue(staff, {});
  assert(queue.items.some((item) => item.id === job.id && item.acknowledgedAt === null));
  await reviews.handle(job);
  await reviews.handle(job);
  assert.equal((await reviews.queue(staff, {})).items.filter((item) => item.id === job.id).length, 1);
  const ack = await reviews.acknowledge(staff, job.id, { reference: 'synthetic:restore-review' });
  assert.deepEqual(await reviews.acknowledge(staff, job.id, { reference: 'synthetic:restore-review' }), ack);
  assert.equal((await runtime.query('SELECT * FROM payment_review_cases')).rowCount, 0);
  assert.deepEqual(await journalSnapshot(), before);
  return {
    restoredReceipt: true,
    balancedImmutableJournals: true,
    reconciliationRetry: true,
    reviewRetry: true,
    postBackupAcknowledgmentAbsent: true,
  };
}
