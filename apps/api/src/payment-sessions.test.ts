import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import {
  PaymentSessions,
  QuoteService,
  RideService,
  developmentRates,
  DomainError,
  type PaymentProvider,
  type PaymentReference,
  type PaymentSnapshot,
  type MapsProvider,
} from '@rove/server';
import { createApp } from './app';
let database: Awaited<ReturnType<typeof testDatabase>>;
let application: ReturnType<typeof createApp>;
let now: Date;
let rider: string;
let ride: string;
const source = 'acct_fixture:test';
const create = vi.fn<PaymentProvider['create']>();
const session = vi.fn<PaymentProvider['session']>();
const provider = { create, session } as unknown as PaymentProvider;
const maps: MapsProvider = {
  search: async () => [],
  resolve: async () => {
    throw new Error('unused');
  },
  route: async () => {
    throw new Error('unused');
  },
};
function response(reference: Omit<PaymentReference, 'intentId'>) {
  return {
    payment: {
      ...reference,
      intentId: 'pi_fixture',
      status: 'requires_payment_method',
      capturableCents: 0,
      receivedCents: 0,
    } as PaymentSnapshot,
    clientSecret: 'pi_fixture_secret_private',
  };
}
function request(identity = 'rider', body: unknown = {}) {
  return application.request(`/v1/rides/${ride}/payment-session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${identity}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
beforeAll(async () => {
  database = await testDatabase();
}, 60_000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  await database.pool.query('TRUNCATE outbox,rate_limit_buckets CASCADE');
  rider = randomUUID();
  ride = randomUUID();
  now = new Date('2026-09-07T12:00:00Z');
  const quote = randomUUID();
  for (const [identity, role, id] of [
    ['rider', 'rider', rider],
    ['other', 'rider', randomUUID()],
    ['driver', 'driver', randomUUID()],
  ])
    await database.pool.query('INSERT INTO users(id,subject,name,role) VALUES ($1,$2,$2,$3)', [
      id,
      identity,
      role,
    ]);
  await database.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES ($1,$2,'{}',$3)", [
    quote,
    rider,
    new Date(now.getTime() + 60000),
  ]);
  await database.pool.query(
    'INSERT INTO rides(id,quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES ($1,$2,$3,1050,790,$4)',
    [ride, quote, rider, new Date(now.getTime() + 180000)],
  );
  await database.pool.query(
    "INSERT INTO payment_customers(rider_id,source,customer_id) VALUES ($1,$2,'cus_fixture')",
    [rider, source],
  );
  create.mockReset();
  session.mockReset();
  create.mockImplementation(async (reference) => response(reference));
  session.mockImplementation(async (reference) => response(reference));
  application = createApp({
    pool: database.pool,
    rides: new RideService(database.pool),
    quotes: new QuoteService(database.pool, maps, developmentRates, {
      south: 35,
      north: 37,
      west: -80,
      east: -77,
    }),
    maps,
    verifyIdentity: async (token) => {
      if (!['rider', 'other', 'driver'].includes(token))
        throw new DomainError('UNAUTHENTICATED', 'Sign in.', 401);
      return { subject: token };
    },
    flags: async () => ({ scheduling: false, weekly: false, monthly: false }),
    paymentSessions: new PaymentSessions(database.pool, provider, source, () => now),
  });
});
test('session requires the owning rider and rejects fare/customer injection before calling provider', async () => {
  expect((await request('forged')).status).toBe(401);
  expect((await request('other')).status).toBe(404);
  expect((await request('driver')).status).toBe(404);
  expect((await request('rider', { amountCents: 1, customerId: 'cus_other' })).status).toBe(400);
  expect(create).not.toHaveBeenCalled();
});
test('creation persists its key inputs before the provider call and keeps the client secret out of storage', async () => {
  create.mockImplementation(async (reference) => {
    const rows = (await database.pool.query('SELECT * FROM payment_attempts')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: reference.attemptId, intent_id: null, amount_cents: 1050 });
    return response(reference);
  });
  const result = await request();
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(await result.json()).toEqual({ rideId: ride, clientSecret: 'pi_fixture_secret_private' });
  expect(create.mock.calls[0]![1]).toBe(`rove:${create.mock.calls[0]![0].attemptId}:create`);
  const stored = {
    attempts: (await database.pool.query('SELECT * FROM payment_attempts')).rows,
    outbox: (await database.pool.query('SELECT * FROM outbox')).rows,
  };
  expect(JSON.stringify(stored)).not.toContain('secret_private');
  expect(stored.outbox).toHaveLength(1);
});
test('uncertain provider outcome retries the same attempt/key and later sessions retrieve the mapped intent', async () => {
  create.mockRejectedValueOnce(new DomainError('PAYMENT_PROVIDER_UNAVAILABLE', 'Try again.', 503));
  expect((await request()).status).toBe(503);
  expect((await request()).status).toBe(200);
  expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
  expect((await request()).status).toBe(200);
  expect(create).toHaveBeenCalledTimes(2);
  expect(session).toHaveBeenCalledTimes(1);
  expect((await database.pool.query('SELECT * FROM payment_attempts')).rows).toHaveLength(1);
});
test('concurrent session requests keep one attempt and one reconciliation job', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => request()));
  expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
  expect(new Set(create.mock.calls.map((c) => c[1])).size).toBe(1);
  expect((await database.pool.query('SELECT * FROM payment_attempts')).rows).toHaveLength(1);
  expect((await database.pool.query('SELECT * FROM outbox')).rows).toHaveLength(1);
});
test('cancellation during creation retains the mapping and release reconciliation but withholds the secret', async () => {
  create.mockImplementation(async (reference) => {
    await database.pool.query("UPDATE rides SET state='cancelled',version=version+1 WHERE id=$1", [ride]);
    return response(reference);
  });
  const result = await request();
  expect(result.status).toBe(409);
  expect(JSON.stringify(await result.json())).not.toContain('secret');
  expect((await database.pool.query('SELECT intent_id FROM payment_attempts')).rows[0].intent_id).toBe(
    'pi_fixture',
  );
  expect((await database.pool.query('SELECT topic FROM outbox')).rows[0].topic).toBe('payment.reconcile');
});
test('old unresolved creation stops for review instead of risking another provider intent', async () => {
  create.mockRejectedValueOnce(new DomainError('PAYMENT_PROVIDER_UNAVAILABLE', 'Try again.', 503));
  expect((await request()).status).toBe(503);
  now = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const result = await request();
  expect(result.status).toBe(409);
  expect((await result.json()).error.code).toBe('PAYMENT_CREATION_REVIEW');
  expect(create).toHaveBeenCalledTimes(1);
});
test('unmapped payment profiles and expired new requests never create payment attempts', async () => {
  now = new Date(now.getTime() + 180000);
  expect((await request()).status).toBe(409);
  expect(create).not.toHaveBeenCalled();
  expect((await database.pool.query('SELECT * FROM payment_attempts')).rows).toHaveLength(0);
  now = new Date(now.getTime() - 180000);
  await database.pool.query('DELETE FROM payment_customers');
  const result = await request();
  expect((await result.json()).error.code).toBe('PAYMENT_PROFILE_REQUIRED');
});

test('session budget is shared across retries and rejects excess before provider calls', async () => {
  for (let i = 0; i < 10; i++) expect((await request()).status).toBe(200);
  const calls = create.mock.calls.length + session.mock.calls.length;
  const result = await request();
  expect(result.status).toBe(429);
  expect(result.headers.get('retry-after')).toBeTruthy();
  expect(create.mock.calls.length + session.mock.calls.length).toBe(calls);
});
