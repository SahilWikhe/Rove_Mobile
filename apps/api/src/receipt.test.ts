import { CaptureFees } from '@rove/server';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import {
  QuoteService,
  RideService,
  developmentRates,
  transaction,
  type MapsProvider,
  DisputeReconciler,
  RefundOperations,
  DriverTransfers,
  type DriverTransferSnapshot,
  PaymentLosses,
  RefundReconciler,
  PaymentWebhookInbox,
  StripePaymentProvider,
  OutboxWorker,
} from '@rove/server';
import { createApp } from './app';
let database: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof createApp>;
let rider: string;
let ride: string;
let attempt: string;
const maps: MapsProvider = {
  search: async () => [],
  resolve: async () => {
    throw new Error('unused');
  },
  route: async () => {
    throw new Error('unused');
  },
};
beforeAll(async () => {
  database = await testDatabase();
}, 60000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  await database.pool.query('TRUNCATE rate_limit_buckets');
  rider = randomUUID();
  ride = randomUUID();
  attempt = randomUUID();
  const quote = randomUUID();
  const binding = randomUUID();
  for (const [id, subject, role] of [
    [rider, 'rider', 'rider'],
    [randomUUID(), 'other', 'rider'],
    [randomUUID(), 'driver', 'driver'],
    [randomUUID(), 'staff', 'staff'],
  ])
    await database.pool.query("INSERT INTO users(id,subject,name,role) VALUES($1,$2,'Fixture name',$3)", [
      id,
      subject,
      role,
    ]);
  await database.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
    quote,
    rider,
  ]);
  await database.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,state,fare_cents,earnings_cents,search_deadline,payment_state) VALUES($1,$2,$3,'completed',1050,790,now(),'paid')",
    [ride, quote, rider],
  );
  await database.pool.query(
    "INSERT INTO payment_customers(id,rider_id,source,customer_id) VALUES($1,$2,'acct_private:test','cus_private')",
    [binding, rider],
  );
  await database.pool.query(
    "INSERT INTO payment_attempts(id,ride_id,customer_binding_id,intent_id,source,amount_cents) VALUES($1,$2,$3,'pi_private','acct_private:test',1050)",
    [attempt, ride, binding],
  );
  app = buildApp();
});
function buildApp(
  refundsEnabled = false,
  refundOperations?: RefundOperations,
  disputes?: DisputeReconciler,
  paymentLosses?: PaymentLosses,
  driverTransfers?: DriverTransfers,
) {
  return createApp({
    refundsEnabled,
    ...(driverTransfers ? { driverTransfers } : {}),
    ...(paymentLosses ? { paymentLosses } : {}),
    ...(refundOperations ? { refundOperations } : {}),
    ...(disputes ? { disputes } : {}),
    ...(refundsEnabled
      ? {
          paymentWebhooks: new PaymentWebhookInbox(
            database.pool,
            new StripePaymentProvider({
              secretKey: 'sk_test_fixture',
              webhookSecret: 'whsec_fixture',
              live: false,
              paymentMethodConfiguration: 'pmc_fixture',
            }),
            'acct_private:test',
            true,
            !!disputes,
          ),
        }
      : {}),
    pool: database.pool,
    rides: new RideService(database.pool),
    quotes: new QuoteService(database.pool, maps, developmentRates, {
      south: 35,
      north: 37,
      west: -80,
      east: -77,
    }),
    maps,
    verifyIdentity: async (token) => ({ subject: token, mfa: token === 'staff' }),
    flags: async () => ({ scheduling: false, weekly: false, monthly: false }),
  });
}

const request = (subject = 'rider', id = ride) =>
  app.request(`/v1/rides/${id}/receipt`, { headers: { Authorization: `Bearer ${subject}` } });
async function capture(amount = 1050, canonicalKey = false) {
  return transaction(database.pool, async (client) => {
    const id = randomUUID();
    await client.query(
      "INSERT INTO ledger_journals(id,key,fingerprint,attempt_id,ride_id,kind) VALUES($1::uuid,$4,'fixture',$2,$3,'capture')",
      [id, attempt, ride, canonicalKey ? `${attempt}:capture` : id],
    );
    await client.query(
      "INSERT INTO ledger_postings(journal_id,account,owner_id,amount_cents) VALUES($1,'stripe_clearing',NULL,$2),($1,'rider_funds',$3,-$2)",
      [id, amount, rider],
    );
    return id;
  });
}
test('a paid label without a ledger capture cannot produce a receipt', async () => {
  const result = await request();
  expect(result.status).toBe(409);
  expect((await result.json()).error.code).toBe('RECEIPT_PENDING');
});
test('receipt contains captured amount and receipt reference without provider/customer identifiers', async () => {
  const id = await capture();
  const result = await request();
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  const receipt = await result.json();
  expect(receipt).toMatchObject({
    id,
    rideId: ride,
    quotedFare: { amount: 1050, currency: 'USD' },
    capturedAmount: { amount: 1050, currency: 'USD' },
  });
  expect(Object.keys(receipt).sort()).toEqual([
    'capturedAmount',
    'id',
    'paymentState',
    'quotedFare',
    'recordedAt',
    'rideId',
    'rideState',
  ]);
  expect(JSON.stringify(receipt)).not.toMatch(/pi_private|cus_private|acct_private/);
});
test('other riders, drivers, staff and unknown ride identifiers cannot read the receipt', async () => {
  await capture();
  for (const subject of ['other', 'driver', 'staff']) expect((await request(subject)).status).toBe(404);
  expect((await request('rider', randomUUID())).status).toBe(404);
  expect((await app.request(`/v1/rides/${ride}/receipt`)).status).toBe(401);
});
test('partial captures and cancelled rides report actual recorded funds without inventing a full payment', async () => {
  await capture(500);
  await database.pool.query(
    "UPDATE rides SET state='cancelled',payment_state='review_required' WHERE id=$1",
    [ride],
  );
  const result = await request();
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    capturedAmount: { amount: 500, currency: 'USD' },
    quotedFare: { amount: 1050, currency: 'USD' },
    rideState: 'cancelled',
    paymentState: 'review_required',
  });
});

test('multiple capture journals require review instead of choosing an arbitrary receipt', async () => {
  await capture();
  await capture();
  const result = await request();
  expect(result.status).toBe(409);
  expect((await result.json()).error.code).toBe('RECEIPT_REVIEW');
});
test('a capture linked to another customer owner is not exposed as a rider receipt', async () => {
  await capture();
  await database.pool.query(
    "UPDATE payment_customers SET rider_id=(SELECT id FROM users WHERE subject='other')",
  );
  const result = await request();
  expect(result.status).toBe(409);
  expect((await result.json()).error.code).toBe('RECEIPT_PENDING');
});

test('signed refund webhooks reconcile through durable jobs into only the owner receipt', async () => {
  await database.pool.query('TRUNCATE payment_webhook_events,outbox CASCADE');
  await capture();
  app = buildApp(true);
  expect((await (await request()).json()).refunds).toEqual({ verifiedAt: null, items: [] });
  let status: 'pending' | 'succeeded' = 'pending';
  const reconciliation = new RefundReconciler(
    database.pool,
    {
      refunds: async (reference) => ({
        payment: { ...reference, status: 'succeeded', capturableCents: 0, receivedCents: 1050 },
        refunds: [
          { id: 're_fixture', intentId: reference.intentId, amountCents: 300, status, created: 1700000000 },
        ],
      }),
    },
    'acct_private:test',
  );
  // PostgreSQL timestamps retain sub-millisecond precision; make newly enqueued fixture jobs due.
  const worker = new OutboxWorker(
    database.pool,
    { 'refund.reconcile': reconciliation.handle },
    () => new Date(Date.now() + 1000),
  );
  const eventTime = Math.floor(Date.now() / 1000);
  async function webhook(eventId: string, type: string) {
    const created = eventTime;
    const body = JSON.stringify({
      id: eventId,
      type,
      created,
      livemode: false,
      data: {
        object: {
          id: 're_fixture',
          object: 'refund',
          payment_intent: 'pi_private',
          status: 'succeeded',
          amount: 999999,
          metadata: { private: 'do not persist' },
        },
      },
    });
    const digest = createHmac('sha256', 'whsec_fixture').update(`${created}.${body}`).digest('hex');
    return app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${created},v1=${digest}` },
      body,
    });
  }
  expect((await webhook('evt_refund', 'refund.created')).status).toBe(200);
  expect((await webhook('evt_refund', 'refund.created')).status).toBe(200);
  expect(await worker.runOnce()).toEqual({ processed: 1, failed: 0 });
  const pending = await (await request()).json();
  expect(pending.refunds.items).toEqual([
    {
      id: 're_fixture',
      amount: { amount: 300, currency: 'USD' },
      status: 'pending',
      createdAt: '2023-11-14T22:13:20.000Z',
    },
  ]);
  expect(pending.capturedAmount.amount).toBe(1050);
  expect(pending.refunds.verifiedAt).toBeTruthy();
  status = 'succeeded';
  expect((await webhook('evt_updated', 'refund.updated')).status).toBe(200);
  expect(await worker.runOnce()).toEqual({ processed: 1, failed: 0 });
  const completed = await (await request()).json();
  expect(completed.refunds.items[0].status).toBe('succeeded');
  expect(completed.capturedAmount.amount).toBe(1050);
  for (const subject of ['other', 'driver', 'staff']) expect((await request(subject)).status).toBe(404);
  expect(JSON.stringify(completed)).not.toMatch(/pi_private|cus_private|acct_private|do not persist/);
  expect((await database.pool.query('SELECT * FROM payment_refund_observations')).rowCount).toBe(2);
  app = buildApp(false);
  expect((await (await request()).json()).refunds).toBeUndefined();
});

test('staff refund HTTP endpoints require MFA permission, explicit enablement, and durable idempotency', async () => {
  const staff = (await database.pool.query("SELECT id FROM users WHERE subject='staff'")).rows[0].id;
  const endpoint = `/v1/staff/rides/${ride}/refunds`;
  const call = (subject: string, key = 'fixture-refund-key') =>
    app.request(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${subject}`,
        'content-type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify({ amountCents: 300, reason: 'customer_request', policyReference: 'fixture-v1' }),
    });
  expect((await call('staff')).status).toBe(503);
  const reconciliation = new RefundReconciler(
    database.pool,
    {
      refunds: async (reference) => ({
        payment: { ...reference, status: 'succeeded', capturableCents: 0, receivedCents: 1050 },
        refunds: [],
      }),
    },
    'acct_private:test',
  );
  const ops = new RefundOperations(
    database.pool,
    {
      refund: async () => {
        throw new Error('HTTP must never call provider');
      },
    },
    reconciliation,
    'acct_private:test',
  );
  app = buildApp(true, ops);
  expect((await call('rider')).status).toBe(403);
  expect((await call('staff')).status).toBe(403);
  await database.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'payments.refund')",
    [staff],
  );
  await capture(1050);
  await reconciliation.reconcile('pi_private');
  const response = await call('staff');
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ state: 'queued', amountCents: 300 });
  expect(await (await call('staff')).json()).toEqual(body);
  const recoverEndpoint = `${endpoint}/${body.id}/recover`;
  expect(
    (await app.request(recoverEndpoint, { method: 'POST', headers: { authorization: 'Bearer rider' } }))
      .status,
  ).toBe(403);
  const recovered = await app.request(recoverEndpoint, {
    method: 'POST',
    headers: { authorization: 'Bearer staff' },
  });
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toMatchObject({ id: body.id, state: 'queued' });
  const listed = await app.request(endpoint, { headers: { authorization: 'Bearer staff' } });
  expect(await listed.json()).toMatchObject({ operations: [body] });
  expect(
    (
      await database.pool.query("SELECT * FROM outbox WHERE topic='refund.execute' AND aggregate_id=$1", [
        body.id,
      ])
    ).rowCount,
  ).toBe(1);
});

test('signed dispute events flow through durable worker verification to the protected staff queue', async () => {
  await database.pool.query('TRUNCATE outbox,payment_webhook_events CASCADE');
  await capture();
  const staff = (await database.pool.query("SELECT id FROM users WHERE subject='staff'")).rows[0].id;
  const current = {
    id: 'du_fixture',
    intentId: 'pi_private',
    amountCents: 1050,
    status: 'needs_response' as const,
    reason: 'general',
    created: 1700000000,
    dueBy: 1790000000,
    balanceTransactions: [
      { id: 'txn_dispute', disputeId: 'du_fixture', amountCents: -1050, feeCents: 1500, netCents: -2550 },
    ],
  };
  const service = new DisputeReconciler(
    database.pool,
    {
      disputes: async (reference) => ({
        payment: { ...reference, status: 'succeeded', capturableCents: 0, receivedCents: 1050 },
        disputes: [current],
      }),
    },
    'acct_private:test',
  );
  app = buildApp(true, undefined, service);
  expect(
    (await app.request('/v1/staff/disputes', { headers: { authorization: 'Bearer rider' } })).status,
  ).toBe(403);
  expect(
    (await app.request('/v1/staff/disputes', { headers: { authorization: 'Bearer staff' } })).status,
  ).toBe(403);
  await database.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'payments.dispute.review')",
    [staff],
  );
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    id: 'evt_dispute',
    object: 'event',
    type: 'charge.dispute.created',
    livemode: false,
    created: timestamp,
    data: {
      object: {
        id: 'du_fixture',
        object: 'dispute',
        payment_intent: 'pi_private',
        status: 'won',
        evidence: { customer_email_address: 'private@example.invalid' },
      },
    },
  });
  const signature = createHmac('sha256', 'whsec_fixture').update(`${timestamp}.${payload}`).digest('hex');
  const send = () =>
    app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
      body: payload,
    });
  expect((await send()).status).toBe(200);
  expect((await send()).status).toBe(200);
  const worker = new OutboxWorker(
    database.pool,
    { 'dispute.reconcile': service.handle },
    () => new Date(Date.now() + 1000),
  );
  await worker.runOnce();
  const response = await app.request('/v1/staff/disputes?status=needs_response', {
    headers: { authorization: 'Bearer staff' },
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.items).toHaveLength(1);
  expect(body.items[0]).toMatchObject({
    status: 'needs_response',
    settlementBlocked: true,
    amount: { amount: 1050, currency: 'USD' },
  });
  expect(JSON.stringify(body)).not.toContain('private@example.invalid');
  expect(
    (await database.pool.query("SELECT * FROM ledger_journals WHERE kind='dispute_balance'")).rowCount,
  ).toBe(1);
  expect((await database.pool.query("SELECT * FROM outbox WHERE topic='dispute.reconcile'")).rowCount).toBe(
    1,
  );
  expect(
    (
      await app.request(`/v1/staff/rides/${ride}/disputes/refresh`, {
        method: 'POST',
        headers: { authorization: 'Bearer staff' },
      })
    ).status,
  ).toBe(200);
});

test('staff loss API is disabled by default and applies one authenticated, permitted audited decision', async () => {
  const url = `/v1/staff/rides/${ride}/loss-allocation`;
  expect((await app.request(url, { headers: { Authorization: 'Bearer rider' } })).status).toBe(503);
  await capture();
  await database.pool.query('INSERT INTO payment_refund_checks(attempt_id,verified_at) VALUES($1,now())', [
    attempt,
  ]);
  await database.pool.query('INSERT INTO payment_dispute_checks(attempt_id,verified_at) VALUES($1,now())', [
    attempt,
  ]);
  await database.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) SELECT id,'payments.loss.allocate' FROM users WHERE subject='staff'",
  );
  await transaction(database.pool, async (c) => {
    const journal = randomUUID();
    await c.query(
      "INSERT INTO ledger_journals(id,key,fingerprint,attempt_id,ride_id,kind) VALUES($1::uuid,$1::text,'fixture',$2,$3,'refund_balance')",
      [journal, attempt, ride],
    );
    await c.query(
      "INSERT INTO ledger_postings(journal_id,account,amount_cents) VALUES($1,'refund_suspense',300),($1,'stripe_clearing',-300)",
      [journal],
    );
  });
  app = buildApp(false, undefined, undefined, new PaymentLosses(database.pool, 'acct_private:test'));
  expect((await app.request(url, { headers: { Authorization: 'Bearer rider' } })).status).toBe(403);
  const review = await app.request(url, { headers: { Authorization: 'Bearer staff' } });
  expect(review.status).toBe(200);
  expect(await review.json()).toMatchObject({ refundBalanceCents: 300, riderFundsCents: 1050 });
  const options = {
    method: 'POST',
    headers: {
      Authorization: 'Bearer staff',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'loss-http-retry',
    },
    body: JSON.stringify({
      kind: 'refund',
      expectedBalanceCents: 300,
      riderFundsCents: 300,
      driverCents: 0,
      platformCents: 0,
      policyReference: 'fixture-policy',
    }),
  };
  const first = await app.request(url, options);
  expect(first.status).toBe(200);
  expect(await (await app.request(url, options)).json()).toEqual(await first.json());
  expect((await database.pool.query('SELECT * FROM payment_loss_allocations')).rowCount).toBe(1);
});

test('staff transfer HTTP flow authenticates, reserves, settles through the worker and exposes recovery without provider identifiers', async () => {
  const url = `/v1/staff/rides/${ride}/transfers`;
  expect((await app.request(url)).status).toBe(401);
  expect((await app.request(url, { headers: { Authorization: 'Bearer staff' } })).status).toBe(503);
  await database.pool.query('TRUNCATE outbox CASCADE');
  const driver = (await database.pool.query("SELECT id FROM users WHERE subject='driver'")).rows[0].id;
  await database.pool.query(
    "INSERT INTO drivers(id,approved,eligibility_expires_at) VALUES($1,true,now()+interval '1 day')",
    [driver],
  );
  await database.pool.query('UPDATE rides SET driver_id=$1 WHERE id=$2', [driver, ride]);
  await database.pool.query(
    "INSERT INTO driver_payout_accounts(driver_id,source,account_id) VALUES($1,'acct_private:test','acct_driver')",
    [driver],
  );
  await capture(1050, true);
  await transaction(database.pool, async (c) => {
    const journal = randomUUID();
    await c.query(
      "INSERT INTO ledger_journals(id,key,fingerprint,attempt_id,ride_id,kind) VALUES($1::uuid,$1::text,'fixture',$2,$3,'allocation')",
      [journal, attempt, ride],
    );
    await c.query(
      "INSERT INTO ledger_postings(journal_id,account,owner_id,amount_cents) VALUES($1,'rider_funds',$2,1050),($1,'driver_payable',$3,-790),($1,'platform_revenue',NULL,-260)",
      [journal, rider, driver],
    );
  });
  await database.pool.query(
    'INSERT INTO payment_refund_checks(attempt_id,verified_at,received_cents) VALUES($1,now(),1050)',
    [attempt],
  );
  await database.pool.query('INSERT INTO payment_dispute_checks(attempt_id,verified_at) VALUES($1,now())', [
    attempt,
  ]);
  const disputes = new DisputeReconciler(
    database.pool,
    {
      disputes: async () => {
        throw new Error('unused');
      },
    },
    'acct_private:test',
  );
  let observed: DriverTransferSnapshot | null = null;
  const captureFees = new CaptureFees(
    database.pool,
    {
      retrieve: async () => ({
        chargeId: 'ch_fixture',
        balanceId: 'txn_capture',
        amountCents: 1050,
        feeCents: 0,
        netCents: 1050,
        status: 'available',
        disputed: false,
        unrefundedCents: 1050,
      }),
    },
    'acct_private:test',
  );
  await captureFees.reconcile('pi_private');
  const transfers = new DriverTransfers(
    database.pool,
    {
      funding: async () => ({ chargeId: 'ch_fixture', unrefundedCents: 1050 }),
      create: async (r) =>
        (observed = {
          id: 'tr_fixture',
          created: Math.floor(Date.now() / 1000),
          amountCents: r.amountCents,
          reversedCents: 0,
          movements: [
            {
              id: 'txn_transfer',
              sourceId: 'tr_fixture',
              kind: 'transfer',
              amountCents: -r.amountCents,
              feeCents: 0,
              netCents: -r.amountCents,
            },
          ],
        }),
      find: async () => observed,
      retrieve: async () => {
        if (!observed) throw new Error('missing');
        return observed;
      },
    },
    { reconcile: async () => {} },
    { reconcile: async () => {}, assertRefundable: disputes.assertRefundable.bind(disputes) },
    'acct_private:test',
    captureFees,
  );
  app = buildApp(false, undefined, undefined, undefined, transfers);
  const options = {
    method: 'POST',
    headers: {
      Authorization: 'Bearer staff',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'http-transfer-one',
    },
    body: JSON.stringify({ amountCents: 600, policyReference: 'fixture-approved-policy' }),
  };
  expect((await app.request(url, options)).status).toBe(403);
  await database.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) SELECT id,'payments.transfer' FROM users WHERE subject='staff'",
  );
  expect((await app.request(url, { headers: { Authorization: 'Bearer rider' } })).status).toBe(403);
  const authorized = await app.request(url, options);
  expect(authorized.status).toBe(200);
  const operation = await authorized.json();
  expect(operation.state).toBe('queued');
  expect(await (await app.request(url, options)).json()).toEqual(operation);
  const worker = new OutboxWorker(database.pool, { 'transfer.execute': transfers.handle });
  expect(await worker.runOnce()).toEqual({ processed: 1, failed: 0 });
  const listed = await (await app.request(url, { headers: { Authorization: 'Bearer staff' } })).json();
  expect(listed.operations).toMatchObject([{ id: operation.id, state: 'confirmed', amountCents: 600 }]);
  expect(JSON.stringify(listed)).not.toContain('acct_');
  expect(JSON.stringify(listed)).not.toContain('tr_fixture');
  expect(
    (await app.request(`${url}/${operation.id}/cancel`, { method: options.method, headers: options.headers }))
      .status,
  ).toBe(409);
  expect(
    (
      await app.request(`${url}/${operation.id}/recover`, {
        method: 'POST',
        headers: { Authorization: 'Bearer staff' },
      })
    ).status,
  ).toBe(200);
  await database.pool.query("DELETE FROM staff_permissions WHERE permission='payments.transfer'");
  expect(
    (
      await app.request(`${url}/${operation.id}/recover`, {
        method: 'POST',
        headers: { Authorization: 'Bearer staff' },
      })
    ).status,
  ).toBe(403);
});
