import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { QuoteService, RideService, developmentRates, transaction, type MapsProvider } from '@rove/server';
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
  app = createApp({
    pool: database.pool,
    rides: new RideService(database.pool),
    quotes: new QuoteService(database.pool, maps, developmentRates, {
      south: 35,
      north: 37,
      west: -80,
      east: -77,
    }),
    maps,
    verifyIdentity: async (token) => ({ subject: token }),
    flags: async () => ({ scheduling: false, weekly: false, monthly: false }),
  });
});
const request = (subject = 'rider', id = ride) =>
  app.request(`/v1/rides/${id}/receipt`, { headers: { Authorization: `Bearer ${subject}` } });
async function capture(amount = 1050) {
  return transaction(database.pool, async (client) => {
    const id = randomUUID();
    await client.query(
      "INSERT INTO ledger_journals(id,key,fingerprint,attempt_id,ride_id,kind) VALUES($1::uuid,$1::text,'fixture',$2,$3,'capture')",
      [id, attempt, ride],
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
