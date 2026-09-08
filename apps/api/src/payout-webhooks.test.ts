import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createHmac } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import {
  StripePayoutWebhookVerifier,
  PayoutWebhookInbox,
  QuoteService,
  RideService,
  developmentRates,
  type MapsProvider,
} from '@rove/server';
import { createApp } from './app';
let db: Awaited<ReturnType<typeof testDatabase>>;
const config = { secretKey: 'rk_test_fixture', webhookSecret: 'whsec_connectfixture', live: false };
const maps: MapsProvider = {
  search: async () => [],
  resolve: async () => {
    throw new Error('Unused');
  },
  route: async () => {
    throw new Error('Unused');
  },
};
function app(enabled = true) {
  return createApp({
    pool: db.pool,
    maps,
    rides: new RideService(db.pool),
    quotes: new QuoteService(db.pool, maps, developmentRates, { south: 35, north: 37, west: -80, east: -77 }),
    verifyIdentity: async () => {
      throw new Error('Not mobile auth');
    },
    flags: async () => ({ scheduling: false, weekly: false, monthly: false }),
    ...(enabled
      ? {
          payoutWebhooks: new PayoutWebhookInbox(
            db.pool,
            new StripePayoutWebhookVerifier(config),
            'acct_platform:test',
          ),
        }
      : {}),
  });
}
function event(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt_fixture',
    object: 'v2.core.event',
    type: 'v2.core.account[configuration.recipient].capability_status_updated',
    created: '2026-09-08T12:00:00Z',
    livemode: false,
    related_object: {
      id: 'acct_driver',
      type: 'v2.core.account',
      url: 'https://attacker.example/not-followed',
    },
    data: { bank: 'PRIVATE_BANK_DETAILS' },
    ...extra,
  });
}
function sign(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${createHmac('sha256', config.webhookSecret).update(`${timestamp}.${body}`).digest('hex')}`;
}
const send = (body: string, signature = sign(body), enabled = true) =>
  app(enabled).request('/webhooks/stripe-connect', {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body,
  });
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE payout_webhook_events,outbox');
});
test('signed thin events commit one minimal receipt and job despite concurrent retries', async () => {
  const body = event();
  const responses = await Promise.all(Array.from({ length: 5 }, () => send(body)));
  expect(responses.every((r) => r.status === 200)).toBe(true);
  const receipts = (await db.pool.query('SELECT * FROM payout_webhook_events')).rows;
  const jobs = (await db.pool.query('SELECT * FROM outbox')).rows;
  expect(receipts).toHaveLength(1);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    topic: 'payout.reconcile',
    payload: { source: 'acct_platform:test', accountId: 'acct_driver' },
  });
  expect(JSON.stringify({ receipts, jobs })).not.toContain('PRIVATE_BANK');
  expect(JSON.stringify({ receipts, jobs })).not.toContain('attacker.example');
});
test('bad signatures, old signatures and mode mismatch fail before database writes', async () => {
  const body = event();
  expect((await send(body, 'invalid')).status).toBe(400);
  expect((await send(body, sign(body, Math.floor(Date.now() / 1000) - 301))).status).toBe(400);
  expect((await send(event({ livemode: true }))).status).toBe(400);
  expect((await db.pool.query('SELECT * FROM payout_webhook_events')).rows).toHaveLength(0);
});
test('same ID with conflicting signed reference is rejected and old events only trigger fresh reads', async () => {
  expect((await send(event())).status).toBe(200);
  expect((await send(event({ related_object: { id: 'acct_other', type: 'v2.core.account' } }))).status).toBe(
    409,
  );
  expect(
    (await send(event({ id: 'evt_older', created: '2026-09-07T12:00:00Z', type: 'v2.core.account.closed' })))
      .status,
  ).toBe(200);
  expect((await db.pool.query('SELECT * FROM outbox')).rows).toHaveLength(2);
});
test('enqueue failures roll back the receipt so the same delivery can retry', async () => {
  await db.pool.query(
    "ALTER TABLE outbox ADD CONSTRAINT fixture_reject_payout CHECK(topic <> 'payout.reconcile')",
  );
  try {
    expect((await send(event())).status).toBe(500);
    expect((await db.pool.query('SELECT * FROM payout_webhook_events')).rows).toHaveLength(0);
  } finally {
    await db.pool.query('ALTER TABLE outbox DROP CONSTRAINT fixture_reject_payout');
  }
  expect((await send(event())).status).toBe(200);
});
test('unconfigured/oversized/unsupported deliveries do not enqueue work', async () => {
  expect((await send(event(), sign(event()), false)).status).toBe(503);
  const large = 'x'.repeat(1048577);
  expect((await send(large)).status).toBe(413);
  expect(
    (await send(event({ type: 'v2.unrelated', related_object: { id: 'not-an-account', type: 'something' } })))
      .status,
  ).toBe(200);
  expect((await db.pool.query('SELECT * FROM outbox')).rows).toHaveLength(0);
});
