import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { users, drivers, quotes, rides, offers } from '@rove/database';
import { RideService } from './rides';
import { eq } from 'drizzle-orm';
let database: Awaited<ReturnType<typeof testDatabase>>;
let service: RideService;
const now = new Date('2026-09-07T12:00:00Z');
beforeAll(async () => {
  database = await testDatabase();
  service = new RideService(database.pool, () => now);
}, 60_000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  await database.pool.query('TRUNCATE outbox CASCADE');
});
async function setup() {
  const rider = { id: randomUUID(), role: 'rider' as const };
  const driver = { id: randomUUID(), role: 'driver' as const };
  for (const actor of [rider, driver])
    await database.db.insert(users).values({ ...actor, subject: actor.id, name: 'Synthetic' });
  await database.db.insert(drivers).values({
    id: driver.id,
    online: true,
    approved: true,
    payoutReady: true,
    payoutValidUntil: new Date(now.getTime() + 86400000),
    eligibilityExpiresAt: new Date(now.getTime() + 86_400_000),
    locationAt: now,
  });
  const quoteId = randomUUID();
  const place = {
    id: 'fixture',
    label: 'Synthetic address',
    area: 'Synthetic area',
    coordinate: { latitude: 35, longitude: -78 },
  };
  await database.db.insert(quotes).values({
    id: quoteId,
    riderId: rider.id,
    expiresAt: new Date(now.getTime() + 60_000),
    snapshot: {
      id: quoteId,
      riderId: rider.id,
      pickup: place,
      destination: place,
      service: 'standard',
      distanceMeters: 5000,
      durationSeconds: 600,
      fare: { amount: 1050, currency: 'USD' },
      estimatedDriverEarnings: { amount: 790, currency: 'USD' },
      rateVersion: 'synthetic-v1',
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    },
  });
  return { rider, driver, quoteId };
}
async function offered() {
  const f = await setup();
  const ride = await service.request(f.rider, f.quoteId, randomUUID());
  const offerId = randomUUID();
  await database.db.update(rides).set({ paymentState: 'authorized' }).where(eq(rides.id, ride.id));
  await database.db.insert(offers).values({
    id: offerId,
    rideId: ride.id,
    driverId: f.driver.id,
    expiresAt: new Date(now.getTime() + 20_000),
    snapshot: {},
  });
  return { ...f, ride, offerId };
}
test('concurrent retry creates one ride and atomic requested/deadline jobs', async () => {
  const f = await setup();
  const key = randomUUID();
  const result = await Promise.all([
    service.request(f.rider, f.quoteId, key),
    service.request(f.rider, f.quoteId, key),
  ]);
  expect(result[0]).toEqual(result[1]);
  const jobs = (await database.pool.query('SELECT topic,available_at FROM outbox ORDER BY topic')).rows;
  expect(jobs.map((job) => job.topic)).toEqual(['ride.requested', 'ride.search_expire']);
  expect(jobs[1].available_at).toEqual(new Date(now.getTime() + 180000));
  for (const table of ['rides', 'audit', 'commands']) {
    expect((await database.pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count).toBe(1);
  }
  await expect(service.request(f.rider, randomUUID(), key)).rejects.toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
});
test('acceptance retries succeed but another driver cannot access the offer', async () => {
  const f = await offered();
  const key = randomUUID();
  await expect(service.accept({ id: randomUUID(), role: 'driver' }, f.offerId, key)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  const result = await Promise.all([
    service.accept(f.driver, f.offerId, key),
    service.accept(f.driver, f.offerId, key),
  ]);
  expect(result[0]).toEqual(result[1]);
  expect(result[0]?.state).toBe('matched');
});
test('expired offer rejects without partial assignment', async () => {
  const f = await offered();
  await database.db.update(offers).set({ expiresAt: now }).where(eq(offers.id, f.offerId));
  await expect(service.accept(f.driver, f.offerId, randomUUID())).rejects.toMatchObject({ code: 'EXPIRED' });
  const ride = (await database.db.select().from(rides))[0]!;
  expect(ride.driverId).toBeNull();
  expect(ride.state).toBe('searching');
});
test('rider cancellation revokes pending offers and blocks late acceptance', async () => {
  const f = await offered();
  await service.transition(f.rider, f.ride.id, 'cancelled', 1, randomUUID());
  await expect(service.accept(f.driver, f.offerId, randomUUID())).rejects.toMatchObject({
    code: 'OFFER_UNAVAILABLE',
  });
  expect((await database.db.select().from(offers))[0]?.status).toBe('revoked');
});
test('trip lifecycle needs current version, assigned driver and explicit start', async () => {
  const f = await offered();
  await service.accept(f.driver, f.offerId, randomUUID());
  await expect(service.transition(f.driver, f.ride.id, 'completed', 2, randomUUID())).rejects.toMatchObject({
    code: 'INVALID_TRANSITION',
  });
  await expect(service.transition(f.rider, f.ride.id, 'en_route', 2, randomUUID())).rejects.toMatchObject({
    code: 'INVALID_TRANSITION',
  });
  await service.transition(f.driver, f.ride.id, 'en_route', 2, randomUUID());
  await expect(service.transition(f.driver, f.ride.id, 'arrived', 2, randomUUID())).rejects.toMatchObject({
    code: 'STALE_RIDE',
  });
  await service.transition(f.driver, f.ride.id, 'arrived', 3, randomUUID());
  await service.transition(f.driver, f.ride.id, 'in_progress', 4, randomUUID());
  await expect(service.transition(f.rider, f.ride.id, 'cancelled', 5, randomUUID())).rejects.toMatchObject({
    code: 'INVALID_TRANSITION',
  });
  expect((await service.transition(f.driver, f.ride.id, 'completed', 5, randomUUID())).state).toBe(
    'completed',
  );
});

test('a committed booking replays after quote expiry while a new key is rejected', async () => {
  const fixture = await setup();
  const key = randomUUID();
  const original = await service.request(fixture.rider, fixture.quoteId, key);
  const later = new RideService(database.pool, () => new Date(now.getTime() + 120_000));
  expect(await later.request(fixture.rider, fixture.quoteId, key)).toEqual(original);
  await expect(later.request(fixture.rider, fixture.quoteId, randomUUID())).rejects.toMatchObject({
    status: 409,
  });
  expect((await database.pool.query('SELECT count(*) FROM rides')).rows[0].count).toBe('1');
});

test('lost authorization blocks pickup progression but preserves cancellation', async () => {
  const fixture = await offered();
  await service.accept(fixture.driver, fixture.offerId, randomUUID());
  await database.pool.query("UPDATE rides SET payment_state='review_required' WHERE id=$1", [
    fixture.ride.id,
  ]);
  await expect(
    service.transition(fixture.driver, fixture.ride.id, 'en_route', 2, randomUUID()),
  ).rejects.toMatchObject({ code: 'PAYMENT_REQUIRED' });
  expect((await service.transition(fixture.rider, fixture.ride.id, 'cancelled', 2, randomUUID())).state).toBe(
    'cancelled',
  );
});

test('expired payout verification blocks accepting new work but does not abandon an accepted trip', async () => {
  const f = await offered();
  await database.pool.query('UPDATE drivers SET payout_valid_until=$2 WHERE id=$1', [f.driver.id, now]);
  await expect(service.accept(f.driver, f.offerId, randomUUID())).rejects.toMatchObject({
    code: 'DRIVER_UNAVAILABLE',
  });
  await database.pool.query(
    "UPDATE drivers SET payout_valid_until=$2::timestamptz+interval '1 hour' WHERE id=$1",
    [f.driver.id, now],
  );
  const accepted = await service.accept(f.driver, f.offerId, randomUUID());
  await database.pool.query('UPDATE drivers SET payout_ready=false,payout_valid_until=NULL WHERE id=$1', [
    f.driver.id,
  ]);
  const result = await service.transition(f.driver, accepted.id, 'en_route', accepted.version, randomUUID());
  expect(result.state).toBe('en_route');
});
