import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
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
const uploadBytes = new TextEncoder().encode('%PDF-1.7 synthetic driver document');
const documentTransfers = {
  forms: {
    issue: vi.fn(async (input: { id: string; expiresAt: string }) => ({
      documentId: input.id,
      key: `driver-documents/inbox/${input.id}/${randomUUID()}`,
      url: 'https://synthetic-bucket.s3.us-east-2.amazonaws.com/',
      fields: { synthetic: 'test-only' },
      expiresAt: input.expiresAt,
    })),
  },
  inbox: { read: vi.fn(async () => uploadBytes) },
  quarantine: {
    put: vi.fn(async (value: { sha256: string; body: Uint8Array }) => ({
      version: 'synthetic-version',
      sha256: value.sha256,
      bytes: value.body.length,
    })),
  },
};
const walletSessions = {
  customerSession: vi.fn(async () => ({
    customerId: 'cus_fixture',
    clientSecret: 'synthetic-customer-secret',
  })),
  setupSession: vi.fn(async () => ({ clientSecret: 'seti_fixture_secret_synthetic' })),
};
const riderId = randomUUID();
beforeAll(async () => {
  database = await testDatabase();
  app = createApp({
    pool: database.pool,
    walletSessions,
    documentTransfers,
    documentDownloads: {
      issue: async () => ({
        url: 'https://synthetic.example/download',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    },
    pushProjects: {
      rider: '00000000-0000-4000-8000-000000000001',
      driver: '00000000-0000-4000-8000-000000000002',
    },
    rides: new RideService(database.pool),
    quotes: new QuoteService(database.pool, maps, developmentRates, {
      south: 35,
      north: 37,
      west: -80,
      east: -77,
    }),
    maps,
    verifyIdentity: async (token) => {
      if (!['rider', 'new-user', 'driver', 'other-driver', 'staff', 'staff-no-mfa'].includes(token))
        throw new DomainError('UNAUTHENTICATED', 'Please sign in.', 401);
      return { subject: token === 'staff-no-mfa' ? 'staff' : token, mfa: token === 'staff' };
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
  vi.clearAllMocks();
  await database.pool.query('TRUNCATE users CASCADE');
  await database.pool.query('TRUNCATE outbox, rate_limit_buckets CASCADE');
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
  const vehicle = { make: 'Synthetic', model: 'Test van', color: 'Blue', plate: 'TEST-123' };
  await database.pool.query('UPDATE drivers SET vehicle=$2 WHERE id=$1', [
    driver.id,
    JSON.stringify({ ...vehicle, privateReviewNote: 'must not leave server', documentKey: 'private-key' }),
  ]);
  const riderView = await (await request(`/v1/rides/${ride.id}`)).json();
  expect(riderView.driver).toEqual({ name: 'Driver fixture', vehicle });
  await database.pool.query('UPDATE drivers SET vehicle=$2 WHERE id=$1', [
    driver.id,
    JSON.stringify({ make: 'Incomplete legacy record' }),
  ]);
  const missingVehicle = await (await request(`/v1/rides/${ride.id}`)).json();
  expect(missingVehicle.driver).toEqual({ name: 'Driver fixture' });
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
  expect(owned.driver).toBeUndefined();
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

test('staff vehicle endpoints deny access without the explicit review permission', async () => {
  const staffId = randomUUID();
  await database.db
    .insert(users)
    .values({ id: staffId, subject: 'staff', name: 'Synthetic staff', role: 'staff' });
  const target = randomUUID();
  expect(
    (
      await app.request(`/v1/staff/drivers/${target}/vehicle-submission`, {
        headers: { Authorization: 'Bearer staff' },
      })
    ).status,
  ).toBe(403);
  await database.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'driver.vehicle.review')",
    [staffId],
  );
  expect(
    (
      await app.request(`/v1/staff/drivers/${target}/vehicle-submission`, {
        headers: { Authorization: 'Bearer staff' },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await app.request(`/v1/staff/drivers/${target}/vehicle-submission`, {
        headers: { Authorization: 'Bearer staff-no-mfa', 'X-MFA': 'true', amr: 'mfa' },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request(`/v1/staff/drivers/${target}/vehicle-submission`, {
        headers: { Authorization: 'Bearer rider' },
      })
    ).status,
  ).toBe(403);
});

test('support submission is private, idempotent, strict and rate limited', async () => {
  const input = { category: 'account', message: 'Synthetic account support request' };
  const key = randomUUID();
  const created = await request('/v1/support-requests', input, 'rider', key);
  expect(created.status).toBe(200);
  const saved = await created.json();
  expect(created.headers.get('cache-control')).toContain('no-store');
  expect(await (await request('/v1/support-requests', input, 'rider', key)).json()).toEqual(saved);
  expect(await (await request('/v1/support-requests')).json()).toEqual({ requests: [saved] });
  expect((await request('/v1/support-requests', { ...input, ownerId: randomUUID() })).status).toBe(400);
  expect((await request('/v1/staff/support-requests/' + saved.id)).status).toBe(403);
  await request('/v1/support-requests', input);
  await request('/v1/support-requests', input);
  expect((await request('/v1/support-requests', input)).status).toBe(429);
});

test('staff support resolution is permission-gated and returned in owner history', async () => {
  const created = await (
    await request('/v1/support-requests', { category: 'account', message: 'Synthetic support request' })
  ).json();
  const staffId = randomUUID();
  await database.db
    .insert(users)
    .values({ id: staffId, subject: 'staff', name: 'Synthetic staff', role: 'staff' });
  const path = '/v1/staff/support-requests/' + created.id + '/resolve';
  const reply = { response: 'Synthetic account resolution' };
  expect((await request(path, reply, 'rider')).status).toBe(403);
  expect((await request(path, reply, 'staff')).status).toBe(403);
  await database.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'support.read'),($1,'support.resolve')",
    [staffId],
  );
  expect((await request(path, reply, 'staff-no-mfa')).status).toBe(403);
  expect((await request(path, { ...reply, status: 'open' }, 'staff')).status).toBe(400);
  const resolved = await request(path, reply, 'staff');
  expect(resolved.status).toBe(200);
  const history = await (await request('/v1/support-requests')).json();
  expect(history.requests[0]).toMatchObject({ status: 'resolved', response: reply.response });
  expect(history.requests[0]).not.toHaveProperty('resolvedBy');
});

test('support queue requires staff authorization and rejects malformed pagination', async () => {
  expect((await request('/v1/staff/support-requests')).status).toBe(403);
  const staffId = randomUUID();
  await database.db
    .insert(users)
    .values({ id: staffId, subject: 'staff', name: 'Synthetic staff', role: 'staff' });
  await database.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'support.read')", [
    staffId,
  ]);
  expect(
    (await request('/v1/staff/support-requests?afterId=' + randomUUID(), undefined, 'staff')).status,
  ).toBe(400);
  const response = await request('/v1/staff/support-requests', undefined, 'staff');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ requests: [], nextCursor: null });
  expect(response.headers.get('cache-control')).toContain('no-store');
});

test('payout setup requires driver authentication, rejects caller-supplied account IDs and fails closed without provider', async () => {
  const path = '/v1/drivers/me/payout-setup';
  expect((await app.request(path)).status).toBe(401);
  expect((await request(path)).status).toBe(403);
  await request('/v1/me', { name: 'Driver fixture', role: 'driver' }, 'driver');
  const response = await request(path, undefined, 'driver');
  expect(await response.json()).toEqual({ status: 'unavailable' });
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(
    (await request(path, { accountId: 'acct_other', returnUrl: 'https://attacker.example' }, 'driver'))
      .status,
  ).toBe(400);
  expect((await request(path, {}, 'driver')).status).toBe(503);
});
test('Connect return and refresh pages never mark setup complete or reflect query inputs', async () => {
  for (const path of ['/connect/return', '/connect/refresh']) {
    const response = await app.request(path + '?account=private-marker&url=https://attacker.example');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    const html = await response.text();
    expect(html).toContain('rove-driver://payouts');
    expect(html).not.toContain('private-marker');
    expect(html).not.toContain('attacker.example');
  }
});

test('notification registration requires authentication and device proof, with strict redacted responses', async () => {
  const input = {
    installationId: randomUUID(),
    secret: 's'.repeat(43),
    mutationId: randomUUID(),
    expectedRevision: null,
    token: 'ExpoPushToken[synthetic_registration]',
    platform: 'ios',
  };
  const send = (method: string, value: unknown, token = 'rider', path = '/v1/push-installations') =>
    app.request(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  expect((await send('PUT', input, 'unknown')).status).toBe(401);
  expect((await send('PUT', { ...input, ownerId: randomUUID() })).status).toBe(400);
  const saved = await send('PUT', input);
  expect(saved.status).toBe(200);
  expect(saved.headers.get('cache-control')).toContain('no-store');
  expect(await saved.json()).toEqual({ installationId: input.installationId, revision: 1, enabled: true });
  const proof = { installationId: input.installationId, secret: input.secret };
  expect(
    (await send('POST', { ...proof, secret: 'x'.repeat(43) }, 'rider', '/v1/push-installations/status'))
      .status,
  ).toBe(403);
  const status = await send('POST', proof, 'rider', '/v1/push-installations/status');
  expect(await status.json()).toEqual({ installationId: input.installationId, revision: 1, enabled: true });
  const removed = await send('DELETE', { ...proof, mutationId: randomUUID(), expectedRevision: 1 });
  expect(await removed.json()).toEqual({ installationId: input.installationId, revision: 2, enabled: false });
});

test('notification-device management is authenticated, owner scoped and rejects stale revocations', async () => {
  await database.db
    .insert(users)
    .values({ id: randomUUID(), subject: 'driver', name: 'Synthetic driver', role: 'driver' });
  const input = {
    installationId: randomUUID(),
    secret: 's'.repeat(43),
    mutationId: randomUUID(),
    expectedRevision: null,
    token: 'ExpoPushToken[device_list]',
    platform: 'ios',
  };
  const headers = { Authorization: 'Bearer rider', 'Content-Type': 'application/json' };
  expect(
    (await app.request('/v1/push-installations', { method: 'PUT', headers, body: JSON.stringify(input) }))
      .status,
  ).toBe(200);
  expect((await app.request('/v1/me/notification-devices')).status).toBe(401);
  const listed = await app.request('/v1/me/notification-devices', { headers });
  expect(listed.headers.get('cache-control')).toContain('no-store');
  const data = await listed.json();
  expect(data.devices).toHaveLength(1);
  expect(JSON.stringify(data)).not.toContain(input.token);
  expect(JSON.stringify(data)).not.toContain(input.secret);
  const device = data.devices[0];
  const path = `/v1/me/notification-devices/${device.id}`;
  const body = JSON.stringify({ expectedRevision: device.revision, mutationId: randomUUID() });
  expect(
    (
      await app.request(path, {
        method: 'DELETE',
        headers: { ...headers, Authorization: 'Bearer driver' },
        body,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await app.request(path, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({
          expectedRevision: device.revision,
          mutationId: randomUUID(),
          ownerId: riderId,
        }),
      })
    ).status,
  ).toBe(400);
  const removed = await app.request(path, { method: 'DELETE', headers, body });
  expect(removed.status).toBe(200);
  expect(await removed.json()).toEqual({ id: device.id, revision: 2, enabled: false });
  expect((await app.request(path, { method: 'DELETE', headers, body })).status).toBe(200);
  expect(
    (
      await app.request(path, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ expectedRevision: 1, mutationId: randomUUID() }),
      })
    ).status,
  ).toBe(409);
});

test('document reservations require driver auth and cannot accept client approval or storage paths', async () => {
  const input = {
    id: randomUUID(),
    kind: 'driver_license',
    contentType: 'application/pdf',
    sha256: 'a'.repeat(64),
    bytes: 100,
  };
  const submit = (value: unknown, token: string) =>
    app.request('/v1/drivers/me/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  expect((await submit(input, 'rider')).status).toBe(403);
  await request('/v1/me', { name: 'Synthetic driver', role: 'driver' }, 'driver');
  expect((await submit({ ...input, state: 'approved', objectKey: 'public/file.pdf' }, 'driver')).status).toBe(
    400,
  );
  const response = await submit(input, 'driver');
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ id: input.id, state: 'reserved' });
  const list = await app.request('/v1/drivers/me/documents', { headers: { Authorization: 'Bearer driver' } });
  const data = await list.json();
  expect(data.documents).toHaveLength(1);
  expect(Object.keys(data.documents[0]).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'kind', 'state']);
});

test('authenticated document flow reserves, signs and verifies before persisting quarantine', async () => {
  await request('/v1/me', { name: 'Synthetic driver', role: 'driver' }, 'driver');
  const reservation = {
    id: randomUUID(),
    kind: 'driver_license',
    contentType: 'application/pdf',
    bytes: uploadBytes.length,
    sha256: createHash('sha256').update(uploadBytes).digest('hex'),
  };
  expect((await request('/v1/drivers/me/documents', reservation, 'driver')).status).toBe(200);
  const path = `/v1/drivers/me/documents/${reservation.id}`;
  const signed = await request(`${path}/upload`, {}, 'driver');
  expect(signed.status).toBe(200);
  expect(signed.headers.get('cache-control')).toBe('no-store');
  const target = await signed.json();
  expect(documentTransfers.forms.issue).toHaveBeenCalledWith(expect.objectContaining(reservation));
  expect((await request(`${path}/complete`, { key: target.key, state: 'approved' }, 'driver')).status).toBe(
    400,
  );
  expect(
    (
      await request(
        `${path}/complete`,
        { key: `driver-documents/inbox/${randomUUID()}/${randomUUID()}` },
        'driver',
      )
    ).status,
  ).toBe(422);
  expect(documentTransfers.inbox.read).not.toHaveBeenCalled();
  const done = await request(`${path}/complete`, { key: target.key }, 'driver');
  expect(done.status).toBe(200);
  expect(await done.json()).toMatchObject({ id: reservation.id, state: 'quarantined' });
  expect((await request(`${path}/complete`, { key: target.key }, 'driver')).status).toBe(200);
  expect(documentTransfers.inbox.read).toHaveBeenCalledTimes(1);
  expect(documentTransfers.quarantine.put).toHaveBeenCalledTimes(1);
  expect((await database.pool.query('SELECT approved FROM drivers')).rows[0].approved).toBe(false);
});
test('upload endpoints reject unauthenticated requests and non-driver roles before storage', async () => {
  const path = `/v1/drivers/me/documents/${randomUUID()}`;
  expect((await app.request(`${path}/upload`, { method: 'POST' })).status).toBe(401);
  expect((await request(`${path}/upload`, {})).status).toBe(403);
  expect((await request(`${path}/complete`, { key: 'anything' })).status).toBe(403);
  expect(documentTransfers.forms.issue).not.toHaveBeenCalled();
  expect(documentTransfers.inbox.read).not.toHaveBeenCalled();
});

test('another driver cannot sign or complete an existing reservation', async () => {
  await request('/v1/me', { name: 'Synthetic driver', role: 'driver' }, 'driver');
  await request('/v1/me', { name: 'Other synthetic driver', role: 'driver' }, 'other-driver');
  const reservation = {
    id: randomUUID(),
    kind: 'driver_license',
    contentType: 'application/pdf',
    bytes: uploadBytes.length,
    sha256: createHash('sha256').update(uploadBytes).digest('hex'),
  };
  await request('/v1/drivers/me/documents', reservation, 'driver');
  const path = `/v1/drivers/me/documents/${reservation.id}`;
  expect((await request(`${path}/upload`, {}, 'other-driver')).status).toBe(404);
  expect(
    (
      await request(
        `${path}/complete`,
        { key: `driver-documents/inbox/${reservation.id}/${randomUUID()}` },
        'other-driver',
      )
    ).status,
  ).toBe(404);
  expect(documentTransfers.forms.issue).not.toHaveBeenCalled();
  expect(documentTransfers.inbox.read).not.toHaveBeenCalled();
});

test('staff download HTTP boundary enforces MFA, clean scan and no-store responses', async () => {
  const { DriverDocumentService, DocumentScanWorker } = await import('@rove/server');
  const staffId = randomUUID(),
    driverId = randomUUID(),
    documentId = randomUUID();
  await database.db.insert(users).values([
    { id: staffId, subject: 'staff', name: 'Synthetic staff', role: 'staff' },
    { id: driverId, subject: 'driver', name: 'Synthetic driver', role: 'driver' },
  ]);
  await database.pool.query('INSERT INTO drivers(id) VALUES($1)', [driverId]);
  const route = `/v1/staff/documents/${documentId}/download`;
  expect((await request(route, {}, 'staff')).status).toBe(403);
  await database.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'driver.document.review')",
    [staffId],
  );
  expect((await request(route, {}, 'staff-no-mfa')).status).toBe(403);
  expect((await request(route, {}, 'rider')).status).toBe(403);
  expect((await request(route, {}, 'staff')).status).toBe(409);
  const service = new DriverDocumentService(database.pool);
  const actor = { id: driverId, role: 'driver' as const };
  const metadata = {
    kind: 'driver_license',
    contentType: 'application/pdf',
    sha256: 'a'.repeat(64),
    bytes: 40,
  };
  await service.reserve(actor, { ...metadata, id: documentId });
  await service.recordQuarantine(actor, {
    ...metadata,
    documentId,
    driverId,
    state: 'quarantined',
    key: `driver-documents/quarantine/${documentId}/${randomUUID()}`,
    version: 'synthetic-version',
  });
  await database.pool.query("UPDATE driver_document_scans SET available_at=now()-interval '1 second'");
  await new DocumentScanWorker(database.pool, {
    scan: async (target) => ({ ...target, verdict: 'clean' }),
  }).runOnce();
  const response = await request(route, {}, 'staff');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ url: 'https://synthetic.example/download' });
});

test('wallet endpoints require authentication and reject client-supplied customer identities', async () => {
  expect((await app.request('/v1/wallet/customer-session', { method: 'POST' })).status).toBe(401);
  expect((await request('/v1/wallet/customer-session', { customerId: 'cus_other' })).status).toBe(400);
  expect((await request('/v1/wallet/setup-session', { requestId: 'bad' })).status).toBe(400);
  expect(walletSessions.customerSession).not.toHaveBeenCalled();
  expect(walletSessions.setupSession).not.toHaveBeenCalled();
});
test('wallet credentials are no-store and use the authenticated actor', async () => {
  const response = await request('/v1/wallet/customer-session', {});
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(walletSessions.customerSession).toHaveBeenCalledWith(
    expect.objectContaining({ id: riderId, role: 'rider' }),
  );
  const requestId = randomUUID();
  const setup = await request('/v1/wallet/setup-session', { requestId });
  expect(setup.status).toBe(200);
  expect(setup.headers.get('cache-control')).toBe('no-store');
  expect(walletSessions.setupSession).toHaveBeenCalledWith(
    expect.objectContaining({ id: riderId }),
    requestId,
  );
});
test('driver accounts cannot obtain wallet settings credentials', async () => {
  await database.pool.query("UPDATE users SET role='driver' WHERE id=$1", [riderId]);
  expect((await request('/v1/wallet/customer-session', {})).status).toBe(403);
  expect((await request('/v1/wallet/setup-session', { requestId: randomUUID() })).status).toBe(403);
  expect(walletSessions.customerSession).not.toHaveBeenCalled();
  expect(walletSessions.setupSession).not.toHaveBeenCalled();
});

test('wallet settings and setup share the payment-session request limit', async () => {
  for (let index = 0; index < 10; index++) {
    const response =
      index % 2 === 0
        ? await request('/v1/wallet/customer-session', {})
        : await request('/v1/wallet/setup-session', { requestId: randomUUID() });
    expect(response.status).toBe(200);
  }
  expect((await request('/v1/wallet/customer-session', {})).status).toBe(429);
  expect(walletSessions.customerSession).toHaveBeenCalledTimes(5);
  expect(walletSessions.setupSession).toHaveBeenCalledTimes(5);
});

test('earnings date parameters are paired, validated and preserve the original unfiltered response', async () => {
  await database.pool.query("UPDATE users SET role='driver' WHERE id=$1", [riderId]);
  for (const query of [
    'from=2026-09-01',
    'through=2026-09-30',
    'from=2026-02-30&through=2026-03-01',
    'from=2026-09-30&through=2026-09-01',
  ]) {
    const response = await request('/v1/drivers/me/earnings?' + query);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_DATE_RANGE' } });
  }
  const response = await request('/v1/drivers/me/earnings?from=2026-09-01&through=2026-09-30');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ periodTotal: { amount: 0, currency: 'USD' } });
  const unfiltered = await request('/v1/drivers/me/earnings');
  expect(await unfiltered.json()).not.toHaveProperty('periodTotal');
});

test('messaging HTTP validates input, scopes conversations and acknowledges only real messages', async () => {
  const driver = await (
    await request('/v1/me', { name: 'Synthetic Driver', role: 'driver' }, 'driver')
  ).json();
  const quote = randomUUID(),
    ride = randomUUID(),
    offer = randomUUID();
  await database.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
    quote,
    riderId,
  ]);
  await database.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,driver_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,$4,'matched',1000,700,now())",
    [ride, quote, riderId, driver.id],
  );
  await database.pool.query(
    "INSERT INTO offers(id,ride_id,driver_id,status,expires_at,snapshot) VALUES($1,$2,$3,'accepted',now(),'{}')",
    [offer, ride, driver.id],
  );
  const path = '/v1/conversations/' + offer;
  expect((await app.request(path)).status).toBe(401);
  expect((await request('/v1/conversations/not-an-id')).status).toBe(400);
  expect((await request('/v1/conversations?beforeId=' + offer)).status).toBe(400);
  expect((await request(path + '/messages', { text: '', requestId: randomUUID() })).status).toBe(400);
  expect(
    (await request(path + '/messages', { text: 'hello', requestId: randomUUID(), senderId: driver.id }))
      .status,
  ).toBe(400);
  const sent = await request(path + '/messages', { text: 'At the entrance', requestId: randomUUID() });
  expect(sent.status).toBe(200);
  const m = await sent.json();
  const thread = await request(path, undefined, 'driver');
  expect(thread.headers.get('Cache-Control')).toBe('no-store');
  expect((await thread.json()).messages[0].mine).toBe(false);
  expect((await (await request('/v1/conversations-unread', undefined, 'driver')).json()).unread).toBe(1);
  expect((await request(path + '/read', { through: m.sequence }, 'driver')).status).toBe(200);
  expect((await request(path + '/report', { reason: 'spam' }, 'driver')).status).toBe(200);
  expect((await request(path + '/messages', { text: 'blocked', requestId: randomUUID() })).status).toBe(409);
});
