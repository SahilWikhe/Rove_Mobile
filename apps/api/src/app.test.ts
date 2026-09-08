import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { users } from '@rove/database';
import { QuoteService, RideService, developmentRates, DomainError, type MapsProvider } from '@rove/server';
import { createApp } from './app';
let database: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof createApp>;
const place = {
  id: 'synthetic-place',
  label: 'Synthetic pickup',
  area: 'Raleigh fixture',
  coordinate: { latitude: 35.8, longitude: -78.6 },
};
const maps: MapsProvider = {
  search: async () => [place],
  resolve: async () => place,
  route: async () => ({ distanceMeters: 5000, durationSeconds: 720 }),
};
const riderId = randomUUID();
beforeAll(async () => {
  database = await testDatabase();
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
    verifyIdentity: async (token) => {
      if (!['rider', 'new-user', 'driver'].includes(token))
        throw new DomainError('UNAUTHENTICATED', 'Please sign in.', 401);
      return { subject: token };
    },
    flags: async () => {
      throw new Error('Provider unavailable');
    },
  });
}, 60_000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  await database.pool.query('TRUNCATE outbox');
  await database.db
    .insert(users)
    .values({ id: riderId, subject: 'rider', name: 'Test rider', role: 'rider' });
});
function request(path: string, input?: unknown, token = 'rider', key = randomUUID()) {
  return app.request(path, {
    method: input === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
}
test('health is public while protected endpoints require authentication', async () => {
  expect((await app.request('/health/live')).status).toBe(200);
  for (const path of ['/v1/me', '/v1/me/capabilities', '/v1/places?q=Raleigh'])
    expect((await app.request(path)).status).toBe(401);
  expect((await request('/v1/me', undefined, 'forged')).status).toBe(401);
});
test('signup cannot grant staff or overwrite an existing role', async () => {
  expect((await request('/v1/me', { name: 'Fake staff', role: 'staff' }, 'new-user')).status).toBe(400);
  const driver = await request('/v1/me', { name: 'Driver fixture', role: 'driver' }, 'driver');
  expect(driver.status).toBe(200);
  const row = (await database.pool.query('SELECT approved FROM drivers')).rows[0];
  expect(row.approved).toBe(false);
  expect((await (await request('/v1/me', { name: 'Change role', role: 'driver' })).json()).role).toBe(
    'rider',
  );
});
test('quotes reject fare injection and use provider-resolved place data', async () => {
  const input = {
    pickup: { ...place, label: 'Spoofed', coordinate: { latitude: 0, longitude: 0 } },
    destination: place,
    service: 'standard',
  };
  expect((await request('/v1/quotes', { ...input, fare: 1 })).status).toBe(400);
  const response = await request('/v1/quotes', input);
  expect(response.status).toBe(201);
  const quote = await response.json();
  expect(quote.pickup).toEqual(place);
  expect(quote.fare.amount).toBe(1050);
  const key = randomUUID();
  const first = await request('/v1/ride-requests', { quoteId: quote.id }, 'rider', key);
  const second = await request('/v1/ride-requests', { quoteId: quote.id }, 'rider', key);
  expect(first.status).toBe(201);
  expect(await first.json()).toEqual(await second.json());
});
test('disabled accounts cannot act even with a valid identity', async () => {
  await database.pool.query('UPDATE users SET disabled=true WHERE id=$1', [riderId]);
  expect((await request('/v1/me')).status).toBe(403);
  expect((await request('/v1/me', { name: 'Reenable', role: 'rider' })).status).toBe(403);
});
test('flag outages fail closed and responses never cache personal data', async () => {
  const response = await request('/v1/me/capabilities');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await response.json()).toMatchObject({
    scheduleCreate: false,
    scheduleWeekly: false,
    scheduleMonthly: false,
  });
});
test('malformed bodies and resource ids return safe errors with request ids', async () => {
  const response = await app.request('/v1/quotes', {
    method: 'POST',
    headers: { Authorization: 'Bearer rider', 'Content-Type': 'application/json' },
    body: '{',
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: 'INVALID_BODY', requestId: expect.any(String) },
  });
  expect((await request('/v1/offers/not-a-uuid/accept', {})).status).toBe(400);
  const oversized = await request('/v1/quotes', { text: 'x'.repeat(40_000) });
  expect(oversized.status).toBe(413);
});
test('unassigned drivers cannot read rides and exact details are removed after the trip ends', async () => {
  const driver = await (await request('/v1/me', { name: 'Driver fixture', role: 'driver' }, 'driver')).json();
  const quote = await (
    await request('/v1/quotes', { pickup: place, destination: place, service: 'standard' })
  ).json();
  const ride = await (await request('/v1/ride-requests', { quoteId: quote.id })).json();
  expect((await request(`/v1/rides/${ride.id}`, undefined, 'driver')).status).toBe(404);
  expect((await (await request('/v1/rides', undefined, 'driver')).json()).rides).toEqual([]);
  await database.pool.query("UPDATE rides SET driver_id=$2,state='matched' WHERE id=$1", [
    ride.id,
    driver.id,
  ]);
  const assigned = await (await request(`/v1/rides/${ride.id}`, undefined, 'driver')).json();
  expect(assigned.pickup).toEqual(place);
  expect(assigned.rider).toEqual({ name: 'Test rider' });
  await database.pool.query("UPDATE rides SET state='completed' WHERE id=$1", [ride.id]);
  const completed = await (await request(`/v1/rides/${ride.id}`, undefined, 'driver')).json();
  expect(completed.pickup).toBeUndefined();
  expect(completed.destination).toBeUndefined();
  expect(completed.rider).toBeUndefined();
  const owned = await (await request(`/v1/rides/${ride.id}`)).json();
  expect(owned.pickup).toEqual(place);
});

test('background credentials cannot become account tokens or read trip data', async () => {
  const driver = await (await request('/v1/me', { name: 'Driver fixture', role: 'driver' }, 'driver')).json();
  expect((await request('/v1/drivers/me/tracking-session', {}, 'rider')).status).toBe(403);
  expect((await request('/v1/drivers/me/tracking-session', {}, 'driver')).status).toBe(401);
  await database.pool.query('UPDATE drivers SET online=true WHERE id=$1', [driver.id]);
  const response = await request('/v1/drivers/me/tracking-session', {}, 'driver');
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const grant = await response.json();
  for (const path of ['/v1/me', '/v1/rides', '/v1/drivers/me']) {
    expect((await request(path, undefined, grant.token)).status).toBe(401);
  }
  const location = { coordinate: place.coordinate, sampledAt: new Date().toISOString(), accuracyMeters: 5 };
  expect((await request('/tracking/v1/location', location, 'driver')).status).toBe(401);
  expect((await request('/tracking/v1/location', location, grant.token)).status).toBe(200);
  expect(
    (await request('/tracking/v1/location', { ...location, driverId: riderId }, grant.token)).status,
  ).toBe(400);
});
