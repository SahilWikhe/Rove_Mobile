import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
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
  await database.pool.query('TRUNCATE outbox, rate_limit_buckets');
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

test('maps requests receive a shared limit and Retry-After without raw subject or token storage', async () => {
  const search = vi.spyOn(maps, 'search');
  const responses = await Promise.all(Array.from({ length: 35 }, () => request('/v1/places?q=Raleigh')));
  expect(responses.filter((response) => response.status === 200)).toHaveLength(30);
  const blocked = responses.filter((response) => response.status === 429);
  expect(blocked).toHaveLength(5);
  expect(search).toHaveBeenCalledTimes(30);
  search.mockRestore();
  expect(Number(blocked[0]!.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect((await blocked[0]!.json()).error.code).toBe('RATE_LIMITED');
  expect((await request('/v1/me')).status).toBe(200);
  const rows = (await database.pool.query('SELECT key FROM rate_limit_buckets')).rows;
  expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.key))).toBe(true);
});
test('unverified tokens cannot allocate rate-limit identities', async () => {
  expect((await request('/v1/me', undefined, 'forged')).status).toBe(401);
  expect((await database.pool.query('SELECT count(*) FROM rate_limit_buckets')).rows[0].count).toBe('0');
});

test('background upload throttling returns retry metadata without blocking grant revocation', async () => {
  const driver = await (await request('/v1/me', { name: 'Driver fixture', role: 'driver' }, 'driver')).json();
  await database.pool.query('UPDATE drivers SET online=true WHERE id=$1', [driver.id]);
  const grant = await (await request('/v1/drivers/me/tracking-session', {}, 'driver')).json();
  const location = { coordinate: place.coordinate, sampledAt: new Date().toISOString(), accuracyMeters: 5 };
  expect((await request('/tracking/v1/location', location, grant.token)).status).toBe(200);
  await database.pool.query('UPDATE rate_limit_buckets SET count=60');
  const response = await request('/tracking/v1/location', location, grant.token);
  expect(response.status).toBe(429);
  expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  expect((await request('/v1/me', undefined, 'driver')).status).toBe(200);
  const revoked = await app.request('/tracking/v1/session', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${grant.token}` },
  });
  expect(revoked.status).toBe(200);
  expect((await request('/tracking/v1/location', location, grant.token)).status).toBe(401);
});

test('profile editing is authenticated, owned, strict and returns the saved profile without caching', async () => {
  const update = (token: string, extra = {}) =>
    app.request('/v1/me', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedProfileId: riderId,
        expectedName: 'Test rider',
        name: 'Updated rider',
        ...extra,
      }),
    });
  expect((await update('forged')).status).toBe(401);
  expect((await update('rider', { role: 'staff' })).status).toBe(400);
  const saved = await update('rider');
  expect(saved.status).toBe(200);
  expect(saved.headers.get('cache-control')).toBe('no-store');
  expect(await saved.json()).toEqual({ id: riderId, role: 'rider', name: 'Updated rider' });
  expect((await (await request('/v1/me')).json()).name).toBe('Updated rider');
  expect((await update('rider', { name: 'Conflicting' })).status).toBe(409);
  await database.pool.query('UPDATE users SET disabled=true WHERE id=$1', [riderId]);
  expect((await update('rider')).status).toBe(403);
});

test('saved place endpoints bind the signed-in rider and validate slots and request fields', async () => {
  const headers = { Authorization: 'Bearer rider', 'Content-Type': 'application/json' };
  const put = (slot: string, input: unknown) =>
    app.request(`/v1/saved-places/${slot}`, { method: 'PUT', headers, body: JSON.stringify(input) });
  expect((await app.request('/v1/saved-places')).status).toBe(401);
  expect(
    (await put('home', { placeId: 'synthetic-place', expectedPlaceId: null, riderId: randomUUID() })).status,
  ).toBe(400);
  expect((await put('unknown', { placeId: 'synthetic-place', expectedPlaceId: null })).status).toBe(400);
  expect((await put('home', { placeId: 'synthetic-place', expectedPlaceId: null })).status).toBe(200);
  expect(await (await app.request('/v1/saved-places', { headers })).json()).toEqual({
    places: [{ kind: 'home', placeId: 'synthetic-place' }],
  });
  expect((await app.request('/v1/saved-places/home', { headers })).headers.get('Cache-Control')).toBe(
    'no-store',
  );
  expect(
    (
      await app.request('/v1/saved-places/home', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ expectedPlaceId: 'obsolete' }),
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await app.request('/v1/saved-places/home', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ expectedPlaceId: 'synthetic-place' }),
      })
    ).status,
  ).toBe(200);
  expect((await app.request('/v1/saved-places/home', { headers })).status).toBe(404);
});

test('vehicle submission API never allows client approval fields and requires a driver', async () => {
  const vehicle = {
    make: 'Synthetic',
    model: 'Test',
    year: 2025,
    color: 'Black',
    plate: 'DEMO',
    registrationRegion: 'NC',
    requestedService: 'standard',
  };
  const input = { vehicle, expectedRevision: null };
  const submit = (value: unknown, token: string) =>
    app.request('/v1/drivers/me/vehicle-submission', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  expect((await submit(input, 'rider')).status).toBe(403);
  await request('/v1/me', { name: 'Driver', role: 'driver' }, 'driver');
  expect((await submit({ ...input, approved: true }, 'driver')).status).toBe(400);
  const response = await submit(input, 'driver');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ submission: { vehicle, status: 'pending' } });
  expect(
    (
      await app.request('/v1/drivers/me/vehicle-submission', { headers: { Authorization: 'Bearer driver' } })
    ).headers.get('Cache-Control'),
  ).toBe('no-store');
});
