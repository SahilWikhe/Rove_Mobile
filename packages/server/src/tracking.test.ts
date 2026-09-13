import { Pool } from 'pg';
import { actorTransaction } from './actor-transaction';
import { transaction } from './transactions';
import { bindTrackingScope } from './tracking-scope';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { drivers, users } from '@rove/database';
import { TrackingService } from './tracking';
import { RequestLimiter } from './rate-limits';
import { DriverService } from './drivers';

let runtimePool: Pool;
let database: Awaited<ReturnType<typeof testDatabase>>;
let now: Date;
let tracking: TrackingService;
const actor = { id: randomUUID(), role: 'driver' as const };
const coordinate = { latitude: 35.8, longitude: -78.6 };
const sample = () => ({ coordinate, sampledAt: now.toISOString(), accuracyMeters: 5 });
beforeAll(async () => {
  database = await testDatabase();
  await database.pool.query(
    "CREATE ROLE rls_tracking LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'synthetic-local-only'",
  );
  await database.pool.query('GRANT USAGE ON SCHEMA public TO rls_tracking');
  await database.pool.query(
    'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rls_tracking',
  );
  await database.pool.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO rls_tracking');
  runtimePool = new Pool({
    host: '127.0.0.1',
    port: (await database.pool.query('SELECT inet_server_port() AS port')).rows[0].port,
    database: 'postgres',
    user: 'rls_tracking',
    password: 'synthetic-local-only',
    max: 5,
  });
}, 60_000);
afterAll(async () => {
  await runtimePool?.end();
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  await database.pool.query('TRUNCATE rate_limit_buckets');
  now = new Date('2026-09-07T12:00:00Z');
  tracking = new TrackingService(runtimePool, () => now);
  await database.db
    .insert(users)
    .values({ id: actor.id, subject: actor.id, name: 'Synthetic driver', role: 'driver' });
  await database.db.insert(drivers).values({
    id: actor.id,
    online: true,
    approved: true,
    payoutReady: true,
    payoutValidUntil: new Date(now.getTime() + 86400000),
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
  await new DriverService(runtimePool, () => now).availability(actor, false, undefined, randomUUID());
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

test('concurrent service instances share a driver upload budget, including duplicate deliveries', async () => {
  const grant = await tracking.issue(actor);
  const second = new TrackingService(runtimePool, () => now);
  const results = await Promise.allSettled(
    Array.from({ length: 65 }, (_, index) => (index % 2 ? tracking : second).location(grant.token, sample())),
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(60);
  const failures = results.filter((result) => result.status === 'rejected');
  expect(failures).toHaveLength(5);
  for (const failure of failures)
    expect(failure.reason).toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: expect.any(Number),
    });
  expect((await database.pool.query('SELECT location_sequence FROM drivers')).rows[0].location_sequence).toBe(
    1,
  );
  expect((await database.pool.query('SELECT count FROM rate_limit_buckets')).rows[0].count).toBe(61);
});
test('rotation cannot reset the budget and revocation remains available when exhausted', async () => {
  const first = await tracking.issue(actor);
  await tracking.location(first.token, sample());
  await database.pool.query('UPDATE rate_limit_buckets SET count=60');
  const rotated = await tracking.issue(actor);
  await expect(tracking.location(rotated.token, sample())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  expect(await tracking.revoke(rotated.token)).toEqual({ revoked: true });
  await expect(tracking.location(rotated.token, sample())).rejects.toMatchObject({
    code: 'TRACKING_UNAUTHORIZED',
  });
});
test('unauthorized grants allocate no buckets while invalid samples consume an authenticated budget', async () => {
  await expect(tracking.location('rt_' + 'x'.repeat(43), sample())).rejects.toMatchObject({
    code: 'TRACKING_UNAUTHORIZED',
  });
  const grant = await tracking.issue(actor);
  await database.pool.query('UPDATE users SET disabled=true');
  await expect(tracking.location(grant.token, sample())).rejects.toMatchObject({
    code: 'TRACKING_UNAUTHORIZED',
  });
  expect((await database.pool.query('SELECT * FROM rate_limit_buckets')).rows).toHaveLength(0);
  await database.pool.query('UPDATE users SET disabled=false');
  await expect(tracking.location(grant.token, { ...sample(), accuracyMeters: 999 })).rejects.toMatchObject({
    code: 'INVALID_LOCATION_SAMPLE',
  });
  expect((await database.pool.query('SELECT count FROM rate_limit_buckets')).rows[0].count).toBe(1);
});
test('another driver has an independent budget and the expired window permits fresh locations', async () => {
  const grant = await tracking.issue(actor);
  await tracking.location(grant.token, sample());
  await database.pool.query('UPDATE rate_limit_buckets SET count=60');
  const other = { id: randomUUID(), role: 'driver' as const };
  await database.db
    .insert(users)
    .values({ id: other.id, subject: other.id, name: 'Another fixture', role: 'driver' });
  await database.db.insert(drivers).values({ id: other.id, online: true });
  const independent = await tracking.issue(other);
  expect(await tracking.location(independent.token, sample())).toEqual({ accepted: true });
  await database.pool.query("UPDATE rate_limit_buckets SET expires_at=now()-interval '1 second'");
  now = new Date(now.getTime() + 1000);
  expect(await tracking.location(grant.token, sample())).toEqual({ accepted: true });
});

test('revocation during budget consumption is rechecked before any location update', async () => {
  const grant = await tracking.issue(actor);
  const consume = RequestLimiter.prototype.consume;
  const intercepted = vi
    .spyOn(RequestLimiter.prototype, 'consume')
    .mockImplementationOnce(async function (subject, policy) {
      await consume.call(new RequestLimiter(database.pool), subject, policy);
      await tracking.revoke(grant.token);
    });
  try {
    await expect(tracking.location(grant.token, sample())).rejects.toMatchObject({
      code: 'TRACKING_UNAUTHORIZED',
    });
    expect(
      (await database.pool.query('SELECT location_sequence FROM drivers')).rows[0].location_sequence,
    ).toBe(0);
    expect((await database.pool.query('SELECT count FROM rate_limit_buckets')).rows[0].count).toBe(1);
  } finally {
    intercepted.mockRestore();
  }
});
test('limiter storage failure stops location mutation with a safe unavailable error', async () => {
  const grant = await tracking.issue(actor);
  await database.pool.query('ALTER TABLE rate_limit_buckets RENAME TO unavailable_buckets');
  try {
    await expect(tracking.location(grant.token, sample())).rejects.toMatchObject({
      code: 'RATE_LIMIT_UNAVAILABLE',
      status: 503,
      message: 'Please try again shortly.',
    });
    expect(
      (await database.pool.query('SELECT location_sequence FROM drivers')).rows[0].location_sequence,
    ).toBe(0);
    expect(await tracking.revoke(grant.token)).toEqual({ revoked: true });
  } finally {
    await database.pool.query('ALTER TABLE unavailable_buckets RENAME TO rate_limit_buckets');
  }
});

test('foreground and background updates preserve sample time and reject cross-channel regression', async () => {
  const driverService = new DriverService(runtimePool, () => now);
  const earlier = new Date(now.getTime() - 10000).toISOString();
  await driverService.heartbeat(actor, { ...sample(), sampledAt: earlier, sequence: 1 });
  let stored = (await database.pool.query('SELECT location_at,location_sampled_at FROM drivers')).rows[0];
  expect(stored.location_at.toISOString()).toBe(now.toISOString());
  expect(stored.location_sampled_at.toISOString()).toBe(earlier);
  const grant = await tracking.issue(actor);
  expect(
    await tracking.location(grant.token, {
      ...sample(),
      sampledAt: new Date(now.getTime() - 15000).toISOString(),
    }),
  ).toEqual({ accepted: false });
  expect(await tracking.location(grant.token, sample())).toEqual({ accepted: true });
  await expect(
    driverService.heartbeat(actor, { ...sample(), sampledAt: earlier, sequence: 3 }),
  ).rejects.toMatchObject({ code: 'STALE_LOCATION_SAMPLE' });
  stored = (await database.pool.query('SELECT location_sampled_at FROM drivers')).rows[0];
  expect(stored.location_sampled_at.toISOString()).toBe(now.toISOString());
});

test('tracking owner isolation denies foreign reads, rotation and issuance without exact server scope', async () => {
  const first = await tracking.issue(actor);
  const other = { id: randomUUID(), role: 'driver' as const };
  await database.db
    .insert(users)
    .values({ id: other.id, subject: other.id, name: 'Synthetic other driver', role: 'driver' });
  await database.db.insert(drivers).values({ id: other.id, online: true });
  await tracking.issue(other);
  expect((await runtimePool.query('SELECT * FROM driver_tracking_sessions')).rowCount).toBe(0);
  await actorTransaction(runtimePool, actor, async (c) => {
    expect((await c.query('SELECT * FROM driver_tracking_sessions')).rowCount).toBe(1);
    expect(
      (await c.query('DELETE FROM driver_tracking_sessions WHERE driver_id=$1', [other.id])).rowCount,
    ).toBe(0);
  });
  await expect(
    actorTransaction(runtimePool, actor, async (c) => {
      await bindTrackingScope(c, 'issue', createHash('sha256').update(first.token).digest('hex'));
      await c.query(
        'INSERT INTO driver_tracking_sessions(driver_id,token_hash,expires_at) VALUES($1,$2,$3)',
        [other.id, 'b'.repeat(64), new Date(now.getTime() + 1000)],
      );
    }),
  ).rejects.toMatchObject({ code: '42501' });
  await actorTransaction(runtimePool, actor, async (c) => {
    expect(
      (await c.query("UPDATE driver_tracking_sessions SET expires_at=now()+interval '1 year'")).rowCount,
    ).toBe(0);
  });
});
test('tracking grant read scope cannot mutate and sampled writes cannot rotate or reassign the token', async () => {
  const grant = await tracking.issue(actor),
    hash = createHash('sha256').update(grant.token).digest('hex');
  await transaction(runtimePool, async (c) => {
    await bindTrackingScope(c, 'read', hash);
    expect((await c.query('SELECT * FROM driver_tracking_sessions FOR UPDATE')).rowCount).toBe(1);
    expect((await c.query('DELETE FROM driver_tracking_sessions')).rowCount).toBe(0);
  });
  await expect(
    transaction(runtimePool, async (c) => {
      await bindTrackingScope(c, 'read', hash);
      await c.query('UPDATE driver_tracking_sessions SET sampled_at=now()');
    }),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    transaction(runtimePool, async (c) => {
      await bindTrackingScope(c, 'sample', hash, actor.id);
      await c.query('UPDATE driver_tracking_sessions SET token_hash=$1', ['a'.repeat(64)]);
    }),
  ).rejects.toMatchObject({ code: '42501' });
  await transaction(runtimePool, async (c) => {
    await bindTrackingScope(c, 'sample', hash, randomUUID());
    await expect(c.query('SELECT * FROM driver_tracking_sessions')).resolves.toMatchObject({ rowCount: 1 });
    // Read-lock visibility never grants a write to a different driver.
  });
  await expect(
    transaction(runtimePool, async (c) => {
      await bindTrackingScope(c, 'sample', hash, randomUUID());
      await c.query('UPDATE driver_tracking_sessions SET sampled_at=now()');
    }),
  ).rejects.toMatchObject({ code: '42501' });
  expect((await runtimePool.query('SELECT * FROM driver_tracking_sessions')).rowCount).toBe(0);
  await tracking.revoke(grant.token);
  expect((await database.pool.query('SELECT * FROM driver_tracking_sessions')).rowCount).toBe(0);
});
