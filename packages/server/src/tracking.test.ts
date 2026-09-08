import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { drivers, users } from '@rove/database';
import { TrackingService } from './tracking';
import { DriverService } from './drivers';

let database: Awaited<ReturnType<typeof testDatabase>>;
let now: Date;
let tracking: TrackingService;
const actor = { id: randomUUID(), role: 'driver' as const };
const coordinate = { latitude: 35.8, longitude: -78.6 };
const sample = () => ({ coordinate, sampledAt: now.toISOString(), accuracyMeters: 5 });
beforeAll(async () => {
  database = await testDatabase();
}, 60_000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  now = new Date('2026-09-07T12:00:00Z');
  tracking = new TrackingService(database.pool, () => now);
  await database.db
    .insert(users)
    .values({ id: actor.id, subject: actor.id, name: 'Synthetic driver', role: 'driver' });
  await database.db.insert(drivers).values({
    id: actor.id,
    online: true,
    approved: true,
    payoutReady: true,
    eligibilityExpiresAt: new Date(now.getTime() + 86_400_000),
  });
});
test('grants store only a hash and rotate instead of keeping multiple active devices', async () => {
  const first = await tracking.issue(actor);
  const stored = JSON.stringify((await database.pool.query('SELECT * FROM driver_tracking_sessions')).rows);
  expect(stored).not.toContain(first.token);
  const second = await tracking.issue(actor);
  expect(second.token).not.toBe(first.token);
  await expect(tracking.location(first.token, sample())).rejects.toMatchObject({
    code: 'TRACKING_UNAUTHORIZED',
  });
  expect(await tracking.location(second.token, sample())).toEqual({ accepted: true });
});
test('out-of-order and duplicate callbacks do not overwrite location or refresh freshness', async () => {
  const grant = await tracking.issue(actor);
  expect(await tracking.location(grant.token, sample())).toEqual({ accepted: true });
  const original = now.toISOString();
  now = new Date(now.getTime() + 10_000);
  expect(
    await tracking.location(grant.token, {
      ...sample(),
      sampledAt: original,
      coordinate: { latitude: 0, longitude: 0 },
    }),
  ).toEqual({ accepted: false });
  const row = (await database.pool.query('SELECT location,location_at,location_sequence FROM drivers'))
    .rows[0];
  expect(row.location).toEqual(coordinate);
  expect(row.location_at.toISOString()).toBe(original);
  expect(row.location_sequence).toBe(1);
});
test('expired grants, disabled accounts and offline drivers cannot upload', async () => {
  const grant = await tracking.issue(actor);
  now = new Date(Date.parse(grant.expiresAt));
  await expect(tracking.location(grant.token, sample())).rejects.toMatchObject({
    code: 'TRACKING_UNAUTHORIZED',
  });
  const renewed = await tracking.issue(actor);
  await database.pool.query('UPDATE users SET disabled=true');
  await expect(tracking.location(renewed.token, sample())).rejects.toMatchObject({
    code: 'TRACKING_UNAUTHORIZED',
  });
  await database.pool.query('UPDATE users SET disabled=false');
  await new DriverService(database.pool, () => now).availability(actor, false, undefined, randomUUID());
  expect((await database.pool.query('SELECT * FROM driver_tracking_sessions')).rows).toHaveLength(0);
  await expect(tracking.location(renewed.token, sample())).rejects.toMatchObject({
    code: 'TRACKING_UNAUTHORIZED',
  });
  await expect(tracking.issue(actor)).rejects.toMatchObject({ code: 'TRACKING_UNAUTHORIZED' });
});
test('revoke is idempotent and rider accounts cannot mint grants', async () => {
  await expect(tracking.issue({ ...actor, role: 'rider' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const grant = await tracking.issue(actor);
  await tracking.revoke(grant.token);
  await tracking.revoke(grant.token);
  await expect(tracking.location(grant.token, sample())).rejects.toMatchObject({
    code: 'TRACKING_UNAUTHORIZED',
  });
});
test('rejects stale, inaccurate, impossible and future samples without touching freshness', async () => {
  const grant = await tracking.issue(actor);
  for (const invalid of [
    { ...sample(), sampledAt: new Date(now.getTime() - 31_000).toISOString() },
    { ...sample(), sampledAt: new Date(now.getTime() + 6_000).toISOString() },
    { ...sample(), accuracyMeters: 101 },
    { ...sample(), coordinate: { latitude: 91, longitude: 0 } },
    { ...sample(), driverId: randomUUID() },
  ])
    await expect(tracking.location(grant.token, invalid)).rejects.toMatchObject({
      code: 'INVALID_LOCATION_SAMPLE',
    });
  expect((await database.pool.query('SELECT location_at FROM drivers')).rows[0].location_at).toBeNull();
});
test('concurrent duplicate delivery commits only one update', async () => {
  const grant = await tracking.issue(actor);
  const results = await Promise.all([
    tracking.location(grant.token, sample()),
    tracking.location(grant.token, sample()),
  ]);
  expect(results.filter((result) => result.accepted)).toHaveLength(1);
  expect((await database.pool.query('SELECT location_sequence FROM drivers')).rows[0].location_sequence).toBe(
    1,
  );
});
