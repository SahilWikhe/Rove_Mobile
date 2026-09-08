/** Explicit local runner against isolated Neon staging. Never starts an HTTP listener. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TLSSocket } from 'node:tls';
import { createDatabase } from '@rove/database';
import { stagingUrl } from '@rove/database/staging-config';
import {
  DomainError,
  PaymentCustomers,
  PaymentSessions,
  PaymentReconciler,
  MatchingService,
  QuoteService,
  RideService,
  developmentRates,
  type MapsProvider,
} from '@rove/server';
import { createApp } from './app';
import { LocalPayments } from './local-payments';

const database = createDatabase(stagingUrl(process.env, true));
const { pool } = database;
const run = randomUUID();
const rider = randomUUID();
const driver = randomUUID();
const stranger = randomUUID();
const place = {
  id: 'synthetic-neon-home',
  label: 'Synthetic Neon pickup',
  area: 'Raleigh',
  coordinate: { latitude: 35.7796, longitude: -78.6382 },
};
const destination = {
  ...place,
  id: 'synthetic-neon-work',
  label: 'Synthetic Neon destination',
  coordinate: { latitude: 35.8365, longitude: -78.6427 },
};
const maps: MapsProvider = {
  search: async () => [place, destination],
  resolve: async (id) => {
    const selected = [place, destination].find((item) => item.id === id);
    if (!selected) throw new Error('Unknown synthetic place');
    return selected;
  },
  route: async () => ({ durationSeconds: 720, distanceMeters: 6500 }),
};
const payments = new LocalPayments();
const source = 'acct_syntheticNeon:test';
const reconciler = new PaymentReconciler(pool, payments, source);
const sessions = new PaymentSessions(
  pool,
  payments,
  source,
  undefined,
  new PaymentCustomers(pool, payments, source),
);
const matching = new MatchingService(pool, maps);
const app = createApp({
  pool,
  maps,
  paymentSessions: sessions,
  quotes: new QuoteService(pool, maps, developmentRates, { south: 35, north: 37, west: -80, east: -77 }),
  rides: new RideService(pool),
  flags: async () => ({ scheduling: false, weekly: false, monthly: false }),
  allowedOrigins: [],
  verifyIdentity: async (token) => {
    if (!([rider, driver, stranger] as string[]).includes(token))
      throw new DomainError('UNAUTHENTICATED', 'Invalid smoke identity', 401);
    return { subject: `synthetic-neon:${run}:${token}` };
  },
});
async function request(
  actor: string,
  path: string,
  method = 'GET',
  body?: unknown,
  expected = 200,
  key = randomUUID(),
) {
  const response = await app.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${actor}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(
    response.status,
    expected,
    `${method} ${path} returned ${response.status}, expected ${expected}`,
  );
  return response.json();
}
try {
  const connection = await pool.connect();
  try {
    // PgBouncer's backend pg_stat_ssl is not the application's TLS connection.
    const socket = (connection as unknown as { connection: { stream: unknown } }).connection.stream;
    assert.ok(
      socket instanceof TLSSocket && socket.encrypted && socket.authorized,
      'Database TLS certificate was not verified',
    );
  } finally {
    connection.release();
  }
  const security = (
    await pool.query(`SELECT current_user AS role,
    has_schema_privilege(current_user,'public','CREATE') AS create_schema,
    has_table_privilege(current_user,'users','TRUNCATE') AS truncate_users,
    pg_has_role(current_user,'neon_superuser','MEMBER') AS elevated`)
  ).rows[0];
  assert.equal(security.role, 'rove_staging_app');
  assert.equal(security.create_schema, false);
  assert.equal(security.truncate_users, false);
  assert.equal(security.elevated, false);
  for (const id of [rider, driver, stranger]) {
    await pool.query('INSERT INTO users(id,subject,name,role) VALUES($1,$2,$3,$4)', [
      id,
      `synthetic-neon:${run}:${id}`,
      'Synthetic Neon test',
      id === driver ? 'driver' : 'rider',
    ]);
  }
  await pool.query(
    `INSERT INTO drivers(id,approved,payout_ready,payout_valid_until,eligibility_expires_at,vehicle)
    VALUES($1,true,true,now()+interval '1 hour',now()+interval '1 hour',$2)`,
    [driver, JSON.stringify({ make: 'Synthetic', model: 'Neon test', color: 'Black', plate: 'TEST' })],
  );
  await request('invalid', '/v1/me', 'GET', undefined, 401);
  await request(driver, '/v1/drivers/me/availability', 'PUT', { online: true, coordinate: place.coordinate });
  const quote = await request(
    rider,
    '/v1/quotes',
    'POST',
    { pickup: place, destination, service: 'standard' },
    201,
  );
  const key = randomUUID();
  const ride = await request(rider, '/v1/ride-requests', 'POST', { quoteId: quote.id }, 201, key);
  const retried = await request(rider, '/v1/ride-requests', 'POST', { quoteId: quote.id }, 201, key);
  assert.equal(retried.id, ride.id);
  await request(stranger, `/v1/rides/${ride.id}`, 'GET', undefined, 404);
  await request(rider, `/v1/rides/${ride.id}/payment-session`, 'POST', {});
  const attempt = (await pool.query('SELECT id,intent_id FROM payment_attempts WHERE ride_id=$1', [ride.id]))
    .rows[0];
  await reconciler.reconcile(attempt.intent_id);
  await matching.tick(ride.id);
  const { offers } = await request(driver, '/v1/drivers/me/offers');
  assert.equal(offers.length, 1);
  assert.ok(!JSON.stringify(offers).includes(place.label), 'Offer exposed a precise endpoint');
  let trip = await request(driver, `/v1/offers/${offers[0].id}/accept`, 'POST', {});
  for (const state of ['en_route', 'arrived', 'in_progress', 'completed']) {
    trip = await request(driver, `/v1/rides/${ride.id}/transitions`, 'POST', {
      state,
      expectedVersion: trip.version,
    });
  }
  await reconciler.reconcile(attempt.intent_id);
  const capture = {
    id: randomUUID(),
    topic: 'payment.capture',
    aggregateId: ride.id,
    payload: { attemptId: attempt.id },
    attempt: 1,
  };
  await reconciler.capture(capture);
  await reconciler.capture(capture);
  const receipt = await request(rider, `/v1/rides/${ride.id}/receipt`);
  assert.equal(receipt.rideId, ride.id);
  await request(stranger, `/v1/rides/${ride.id}/receipt`, 'GET', undefined, 404);
  const persisted = (await pool.query('SELECT state,payment_state FROM rides WHERE id=$1', [ride.id]))
    .rows[0];
  assert.deepEqual(persisted, { state: 'completed', payment_state: 'paid' });
  const captures = (
    await pool.query(
      "SELECT count(*)::int AS count FROM ledger_journals WHERE ride_id=$1 AND kind='capture'",
      [ride.id],
    )
  ).rows[0];
  assert.equal(captures.count, 1);
  await request(driver, '/v1/drivers/me/availability', 'PUT', { online: false });
  const cancelQuote = await request(
    rider,
    '/v1/quotes',
    'POST',
    { pickup: place, destination, service: 'standard' },
    201,
  );
  const cancelledRide = await request(rider, '/v1/ride-requests', 'POST', { quoteId: cancelQuote.id }, 201);
  await request(rider, `/v1/rides/${cancelledRide.id}/payment-session`, 'POST', {});
  const cancelledAttempt = (
    await pool.query('SELECT id,intent_id FROM payment_attempts WHERE ride_id=$1', [cancelledRide.id])
  ).rows[0];
  await reconciler.reconcile(cancelledAttempt.intent_id);
  const beforeCancel = await request(rider, `/v1/rides/${cancelledRide.id}`);
  await request(rider, `/v1/rides/${cancelledRide.id}/transitions`, 'POST', {
    state: 'cancelled',
    expectedVersion: beforeCancel.version,
  });
  await reconciler.reconcile(cancelledAttempt.intent_id);
  await reconciler.release({
    id: randomUUID(),
    topic: 'payment.release',
    aggregateId: cancelledRide.id,
    payload: { attemptId: cancelledAttempt.id },
    attempt: 1,
  });
  const released = (await pool.query('SELECT state,payment_state FROM rides WHERE id=$1', [cancelledRide.id]))
    .rows[0];
  assert.deepEqual(released, { state: 'cancelled', payment_state: 'released' });
  const secondConnection = createDatabase(stagingUrl(process.env, true));
  try {
    assert.equal(
      (await secondConnection.pool.query('SELECT state FROM rides WHERE id=$1', [ride.id])).rows[0].state,
      'completed',
    );
  } finally {
    await secondConnection.close();
  }
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        run,
        rideId: ride.id,
        checks: [
          'verified TLS',
          'restricted pooled role',
          'quote',
          'idempotent booking',
          'matching',
          'driver acceptance',
          'trip completion',
          'synthetic capture retry',
          'receipt',
          'ownership rejection',
          'cancellation and hold release',
          'persistence across connections',
        ],
        providers: 'synthetic; no real auth, maps, payments or notifications',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : 'Neon smoke failed; sensitive error details withheld.',
  );
  process.exitCode = 1;
} finally {
  // Retain inspectable test records but do not leave a fixture available for future matching.
  await pool.query('UPDATE drivers SET online=false WHERE id=$1', [driver]).catch(() => {});
  await database.close();
}
