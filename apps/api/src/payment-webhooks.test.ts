import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createHmac } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import {
  PaymentWebhookInbox,
  StripePaymentProvider,
  QuoteService,
  RideService,
  developmentRates,
  type MapsProvider,
} from '@rove/server';
import { createApp } from './app';

let database: Awaited<ReturnType<typeof testDatabase>>;
const config = {
  secretKey: 'sk_test_fixture',
  webhookSecret: 'whsec_fixture',
  live: false,
  paymentMethodConfiguration: 'pmc_fixture',
};
// Independently generate Stripe's documented signature; production SDK verifies it.
// No external account credentials or Stripe API requests.
function sign(payload: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', config.webhookSecret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}
const maps: MapsProvider = {
  search: async () => [],
  resolve: async () => {
    throw new Error('Not used');
  },
  route: async () => {
    throw new Error('Not used');
  },
};
function app(configured = true) {
  return createApp({
    pool: database.pool,
    rides: new RideService(database.pool),
    quotes: new QuoteService(database.pool, maps, developmentRates, {
      south: 35,
      north: 37,
      west: -80,
      east: -77,
    }),
    maps,
    verifyIdentity: async () => {
      throw new Error('Webhooks do not use mobile account authentication');
    },
    flags: async () => ({ scheduling: false, weekly: false, monthly: false }),
    ...(configured
      ? {
          paymentWebhooks: new PaymentWebhookInbox(
            database.pool,
            new StripePaymentProvider(config),
            'acct_fixture:test',
          ),
        }
      : {}),
  });
}
function event(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt_fixture',
    object: 'event',
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: 'pi_fixture',
        client_secret: 'must-not-be-stored',
        customer: { email: 'private@example.invalid' },
      },
    },
    ...extra,
  });
}
function send(body: string, signature?: string, configured = true) {
  return app(configured).request('/webhooks/stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature ?? sign(body),
    },
    body,
  });
}
beforeAll(async () => {
  database = await testDatabase();
}, 60_000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE payment_webhook_events,outbox CASCADE');
});

test('concurrent signed deliveries commit one minimal receipt and one reconciliation job', async () => {
  const payload = event();
  const results = await Promise.all(Array.from({ length: 12 }, () => send(payload)));
  expect(results.map((r) => r.status)).toEqual(Array(12).fill(200));
  expect(await results[0]!.json()).toEqual({ received: true });
  expect(results[0]!.headers.get('cache-control')).toBe('no-store');
  const receipts = (await database.pool.query('SELECT * FROM payment_webhook_events')).rows;
  const jobs = (await database.pool.query('SELECT * FROM outbox')).rows;
  expect(receipts).toHaveLength(1);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    topic: 'payment.reconcile',
    aggregate_id: receipts[0].id,
    payload: { source: 'acct_fixture:test', intentId: 'pi_fixture' },
  });
  expect(JSON.stringify({ receipts, jobs })).not.toMatch(/must-not-be-stored|private@example/);
});
test('tampering, missing signatures, wrong mode and connected-account events never enqueue', async () => {
  const payload = event();
  const signature = sign(payload);
  expect((await send(payload + ' ', signature)).status).toBe(400);
  expect((await send(payload, '')).status).toBe(400);
  expect((await send(event({ livemode: true }))).status).toBe(400);
  expect((await send(event({ account: 'acct_other' }))).status).toBe(400);
  expect((await database.pool.query('SELECT * FROM outbox')).rows).toHaveLength(0);
  expect((await database.pool.query('SELECT * FROM payment_webhook_events')).rows).toHaveLength(0);
});
test('enqueue failures roll back the receipt and allow the same event to retry', async () => {
  const payload = event();
  await database.pool.query(
    "ALTER TABLE outbox ADD CONSTRAINT fixture_reject_payment CHECK (topic <> 'payment.reconcile')",
  );
  try {
    const response = await send(payload);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('fixture_reject');
    expect((await database.pool.query('SELECT * FROM payment_webhook_events')).rows).toHaveLength(0);
  } finally {
    await database.pool.query('ALTER TABLE outbox DROP CONSTRAINT fixture_reject_payment');
  }
  expect((await send(payload)).status).toBe(200);
  expect((await database.pool.query('SELECT * FROM outbox')).rows).toHaveLength(1);
});
test('late events are queued independently without using event order to authorize a ride', async () => {
  const created = Math.floor(Date.now() / 1000);
  expect((await send(event({ id: 'evt_newer', created }))).status).toBe(200);
  expect(
    (await send(event({ id: 'evt_older', created: created - 100, type: 'payment_intent.payment_failed' })))
      .status,
  ).toBe(200);
  expect((await database.pool.query('SELECT topic FROM outbox')).rows).toEqual([
    { topic: 'payment.reconcile' },
    { topic: 'payment.reconcile' },
  ]);
});
test('conflicting duplicate references fail and unsupported events are acknowledged without persistence', async () => {
  const created = Math.floor(Date.now() / 1000);
  expect((await send(event({ created }))).status).toBe(200);
  expect((await send(event({ created, data: { object: { id: 'pi_other' } } }))).status).toBe(409);
  expect(
    (
      await send(
        event({ id: 'evt_ignored', type: 'customer.created', data: { object: { id: 'cus_fixture' } } }),
      )
    ).status,
  ).toBe(200);
  expect((await database.pool.query('SELECT * FROM outbox')).rows).toHaveLength(1);
});
test('unconfigured endpoints reject delivery and webhook size allowance does not widen normal API limits', async () => {
  expect((await send(event(), undefined, false)).status).toBe(503);
  const largeValid = event({ padding: 'x'.repeat(40_000) });
  expect((await send(largeValid)).status).toBe(200);
  expect((await send(event({ padding: 'x'.repeat(1_048_576) }))).status).toBe(413);
  expect((await app().request('/v1/ride-requests', { method: 'POST', body: largeValid })).status).toBe(413);
});
