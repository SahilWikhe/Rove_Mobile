import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { users, drivers, quotes } from '@rove/database';
import { DriverOffer } from '@rove/contracts';
import { DriverService } from './drivers';
import { MatchingService } from './matching';
import { RideService } from './rides';
import type { MapsProvider } from './quotes';
let database: Awaited<ReturnType<typeof testDatabase>>;
let now: Date;
let matcher: MatchingService;
let driverService: DriverService;
let rideService: RideService;
const place = {
  id: 'fixture',
  label: 'Private synthetic address',
  area: 'Coarse fixture area',
  coordinate: { latitude: 35.8, longitude: -78.6 },
};
const maps: MapsProvider = {
  search: async () => [],
  resolve: async () => place,
  route: async () => ({ durationSeconds: 180, distanceMeters: 1000 }),
};
beforeAll(async () => {
  database = await testDatabase();
}, 60_000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  await database.pool.query('TRUNCATE outbox');
  now = new Date('2026-09-07T12:00:00Z');
  matcher = new MatchingService(database.pool, maps, () => now);
  driverService = new DriverService(database.pool, () => now);
  rideService = new RideService(database.pool, () => now);
});
async function driver(eligible = true, service: 'standard' | 'accessible' = 'standard') {
  const id = randomUUID();
  await database.db.insert(users).values({ id, subject: id, name: 'Synthetic driver', role: 'driver' });
  await database.db.insert(drivers).values({
    id,
    service,
    approved: eligible,
    payoutReady: eligible,
    payoutValidUntil: new Date(now.getTime() + 86400000),
    eligibilityExpiresAt: new Date(now.getTime() + 86_400_000),
    online: eligible,
    location: place.coordinate,
    locationAt: now,
  });
  return { id, role: 'driver' as const };
}
async function ride(service: 'standard' | 'accessible' = 'standard') {
  const riderId = randomUUID();
  const quoteId = randomUUID();
  await database.db
    .insert(users)
    .values({ id: riderId, subject: riderId, name: 'Private rider name', role: 'rider' });
  await database.db.insert(quotes).values({
    id: quoteId,
    riderId,
    expiresAt: new Date(now.getTime() + 60_000),
    snapshot: {
      id: quoteId,
      riderId,
      pickup: place,
      destination: place,
      service,
      distanceMeters: 5000,
      durationSeconds: 600,
      fare: { amount: 1050, currency: 'USD' },
      estimatedDriverEarnings: { amount: 790, currency: 'USD' },
      rateVersion: 'fixture',
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    },
  });
  const actor = { id: riderId, role: 'rider' as const };
  const result = await rideService.request(actor, quoteId, randomUUID());
  return { actor, ...result };
}
async function authorize(rideId: string) {
  await database.pool.query("UPDATE rides SET payment_state='authorized' WHERE id=$1", [rideId]);
}
test('unfunded requests produce no offer; concurrent funded ticks create one private offer', async () => {
  const d = await driver();
  const r = await ride();
  await matcher.tick(r.id);
  expect((await driverService.offers(d)).offers).toHaveLength(0);
  await authorize(r.id);
  await Promise.all([matcher.tick(r.id), matcher.tick(r.id)]);
  const received = (await driverService.offers(d)).offers;
  expect(received).toHaveLength(1);
  expect(DriverOffer.safeParse(received[0]).success).toBe(true);
  const json = JSON.stringify(received);
  expect(json).not.toContain('Private');
  expect(json).not.toContain('coordinate');
  expect(json).not.toContain('riderId');
  expect((await database.pool.query("SELECT id FROM outbox WHERE topic='offer.created'")).rowCount).toBe(1);
});
test('expiry advances to another driver and late acceptance fails', async () => {
  await driver();
  await driver();
  const r = await ride();
  await authorize(r.id);
  await matcher.tick(r.id);
  const first = (await database.pool.query('SELECT * FROM offers')).rows[0];
  now = new Date(now.getTime() + 20_000);
  await matcher.tick(r.id);
  const rows = (await database.pool.query('SELECT * FROM offers ORDER BY expires_at')).rows;
  expect(rows).toHaveLength(2);
  expect(rows[0].status).toBe('expired');
  expect(rows[1].driver_id).not.toBe(first.driver_id);
  await expect(
    rideService.accept({ id: first.driver_id, role: 'driver' }, first.id, randomUUID()),
  ).rejects.toMatchObject({ code: 'OFFER_UNAVAILABLE' });
});
test('decline wakes matching and does not offer the same ride to that driver again', async () => {
  await driver();
  await driver();
  const r = await ride();
  await authorize(r.id);
  await matcher.tick(r.id);
  const first = (await database.pool.query('SELECT * FROM offers')).rows[0];
  await driverService.decline({ id: first.driver_id, role: 'driver' }, first.id, randomUUID());
  await matcher.tick(r.id);
  expect(
    (await database.pool.query("SELECT driver_id FROM offers WHERE status='pending'")).rows[0].driver_id,
  ).not.toBe(first.driver_id);
});
test('cancellation while directions are in flight prevents an offer', async () => {
  await driver();
  const r = await ride();
  await authorize(r.id);
  const cancelMaps: MapsProvider = {
    ...maps,
    route: async () => {
      await rideService.transition(r.actor, r.id, 'cancelled', 1, randomUUID());
      return { durationSeconds: 60, distanceMeters: 100 };
    },
  };
  await new MatchingService(database.pool, cancelMaps, () => now).tick(r.id);
  expect((await database.pool.query('SELECT * FROM offers')).rowCount).toBe(0);
});
test('search deadline records no-driver outcome and payment-release event', async () => {
  const r = await ride();
  await authorize(r.id);
  await matcher.tick(r.id);
  expect((await database.pool.query("SELECT id FROM outbox WHERE topic='matching.tick'")).rowCount).toBe(1);
  now = new Date(now.getTime() + 180_000);
  await matcher.tick(r.id);
  expect((await database.pool.query('SELECT state FROM rides WHERE id=$1', [r.id])).rows[0].state).toBe(
    'no_driver_found',
  );
  expect(
    (await database.pool.query("SELECT id FROM outbox WHERE topic='ride.no_driver_found'")).rowCount,
  ).toBe(1);
});
test('unapproved drivers cannot go online; location rejects stale or inaccurate samples', async () => {
  const d = await driver(false);
  await expect(driverService.availability(d, true, place.coordinate, randomUUID())).rejects.toMatchObject({
    code: 'DRIVER_INELIGIBLE',
  });
  const eligible = await driver();
  await driverService.availability(eligible, true, place.coordinate, randomUUID());
  const sample = {
    coordinate: place.coordinate,
    sampledAt: now.toISOString(),
    sequence: 2,
    accuracyMeters: 5,
  };
  expect(await driverService.heartbeat(eligible, sample)).toEqual({ accepted: true });
  await expect(driverService.heartbeat(eligible, sample)).rejects.toMatchObject({
    code: 'STALE_LOCATION_SAMPLE',
  });
  await expect(
    driverService.heartbeat(eligible, { ...sample, sequence: 3, accuracyMeters: 500 }),
  ).rejects.toMatchObject({ code: 'INVALID_LOCATION_SAMPLE' });
});
test('an assigned driver cannot go offline and cannot receive a second offer', async () => {
  const d = await driver();
  const r = await ride();
  await authorize(r.id);
  await matcher.tick(r.id);
  const offer = (await driverService.offers(d)).offers[0]!;
  await rideService.accept(d, offer.id, randomUUID());
  await expect(driverService.availability(d, false, undefined, randomUUID())).rejects.toMatchObject({
    code: 'ACTIVE_TRIP',
  });
  const next = await ride();
  await authorize(next.id);
  await matcher.tick(next.id);
  expect((await driverService.offers(d)).offers).toHaveLength(0);
});

test('accessible requests only reach eligible accessible drivers', async () => {
  const standard = await driver();
  const accessible = await driver(true, 'accessible');
  const request = await ride('accessible');
  await authorize(request.id);
  await matcher.tick(request.id);
  expect((await driverService.offers(standard)).offers).toEqual([]);
  const offers = (await driverService.offers(accessible)).offers;
  expect(offers).toHaveLength(1);
  expect(offers[0]?.service).toBe('accessible');
  await rideService.accept(accessible, offers[0]!.id, randomUUID());
  expect(
    (await database.pool.query('SELECT driver_id FROM rides WHERE id=$1', [request.id])).rows[0].driver_id,
  ).toBe(accessible.id);
});
test('accessible requests never fall back to a standard vehicle when none is eligible', async () => {
  const standard = await driver();
  const request = await ride('accessible');
  await authorize(request.id);
  await matcher.tick(request.id);
  expect((await driverService.offers(standard)).offers).toEqual([]);
  now = new Date(now.getTime() + 180_000);
  await matcher.tick(request.id);
  expect((await database.pool.query('SELECT state FROM rides WHERE id=$1', [request.id])).rows[0].state).toBe(
    'no_driver_found',
  );
});
test('losing accessible eligibility during directions prevents offer creation', async () => {
  const candidate = await driver(true, 'accessible');
  const request = await ride('accessible');
  await authorize(request.id);
  const changingMaps: MapsProvider = {
    ...maps,
    route: async () => {
      await database.pool.query("UPDATE drivers SET service='standard' WHERE id=$1", [candidate.id]);
      return { durationSeconds: 60, distanceMeters: 100 };
    },
  };
  await new MatchingService(database.pool, changingMaps, () => now).tick(request.id);
  expect((await database.pool.query('SELECT id FROM offers')).rowCount).toBe(0);
});
test('losing accessible eligibility after an offer prevents assignment', async () => {
  const candidate = await driver(true, 'accessible');
  const request = await ride('accessible');
  await authorize(request.id);
  await matcher.tick(request.id);
  const offer = (await driverService.offers(candidate)).offers[0]!;
  await database.pool.query("UPDATE drivers SET service='standard' WHERE id=$1", [candidate.id]);
  await expect(rideService.accept(candidate, offer.id, randomUUID())).rejects.toMatchObject({
    code: 'DRIVER_UNAVAILABLE',
  });
  const saved = (await database.pool.query('SELECT state,driver_id FROM rides WHERE id=$1', [request.id]))
    .rows[0];
  expect(saved).toMatchObject({ state: 'searching', driver_id: null });
});

test('expired payout freshness blocks candidates and expires their pending offers', async () => {
  const candidate = await driver(true, 'standard');
  const request = await ride('standard');
  await authorize(request.id);
  await database.pool.query('UPDATE drivers SET payout_valid_until=$2 WHERE id=$1', [candidate.id, now]);
  await matcher.tick(request.id);
  expect((await database.pool.query('SELECT id FROM offers')).rowCount).toBe(0);
  await database.pool.query(
    "UPDATE drivers SET payout_valid_until=$2::timestamptz+interval '1 hour' WHERE id=$1",
    [candidate.id, now],
  );
  await matcher.tick(request.id);
  expect((await driverService.offers(candidate)).offers).toHaveLength(1);
  await database.pool.query('UPDATE drivers SET payout_valid_until=NULL WHERE id=$1', [candidate.id]);
  expect((await driverService.offers(candidate)).offers).toHaveLength(0);
  await matcher.tick(request.id);
  expect((await database.pool.query('SELECT status FROM offers')).rows[0].status).toBe('expired');
});
