import { RideService } from './rides';
import { bindUserRead } from './user-scope';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { actorTransaction } from './actor-transaction';
import { bindRideRead, bindRideMutation, bindRideCreation } from './ride-scope';
import { transaction } from './transactions';
let db: Awaited<ReturnType<typeof testDatabase>>;
let runtime: Pool;
let rider: string, driver: string, foreign: string, ride: string;
beforeAll(async () => {
  db = await testDatabase();
  const password = randomBytes(32).toString('hex');
  await db.pool.query(`CREATE ROLE ride_policy_probe LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
  await db.pool.query(
    'GRANT USAGE ON SCHEMA public TO ride_policy_probe; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ride_policy_probe',
  );
  const url = new URL(db.connectionString);
  url.username = 'ride_policy_probe';
  url.password = password;
  runtime = new Pool({ connectionString: url.toString(), max: 1 });
}, 60000);
afterAll(async () => {
  await runtime?.end();
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  rider = randomUUID();
  driver = randomUUID();
  foreign = randomUUID();
  ride = randomUUID();
  for (const [id, role] of [
    [rider, 'rider'],
    [driver, 'driver'],
    [foreign, 'rider'],
  ])
    await db.pool.query("INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Synthetic',$2)", [
      id,
      role,
    ]);
  await db.pool.query('INSERT INTO drivers(id) VALUES($1)', [driver]);
  const quote = randomUUID();
  await db.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
    quote,
    rider,
  ]);
  await db.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,driver_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,$4,'matched',1000,750,now())",
    [ride, quote, rider, driver],
  );
});
test('only participants see rides, read scope cannot mutate or delete, and pool reuse clears access', async () => {
  expect((await runtime.query('SELECT id FROM rides')).rowCount).toBe(0);
  for (const actor of [
    { id: rider, role: 'rider' as const },
    { id: driver, role: 'driver' as const },
  ])
    await actorTransaction(runtime, actor, async (c) => {
      expect((await c.query('SELECT id FROM rides FOR UPDATE')).rows).toEqual([{ id: ride }]);
      expect((await c.query('DELETE FROM rides')).rowCount).toBe(0);
    });
  await actorTransaction(runtime, { id: foreign, role: 'rider' }, async (c) =>
    expect((await c.query('SELECT id FROM rides')).rowCount).toBe(0),
  );
  await expect(
    actorTransaction(runtime, { id: rider, role: 'rider' }, async (c) => {
      await c.query("UPDATE rides SET state='cancelled'");
    }),
  ).rejects.toMatchObject({ code: '42501' });
  expect((await runtime.query('SELECT id FROM rides')).rowCount).toBe(0);
});
test('transition permits a versioned state change but rejects fare or ownership changes', async () => {
  await actorTransaction(runtime, { id: driver, role: 'driver' }, async (c) => {
    await bindRideMutation(c, ride, 'transition');
    expect(
      (await c.query("UPDATE rides SET state='en_route',version=version+1 WHERE id=$1", [ride])).rowCount,
    ).toBe(1);
  });
  for (const update of ['fare_cents=1', 'rider_id=$2', 'version=version'])
    await expect(
      actorTransaction(runtime, { id: driver, role: 'driver' }, async (c) => {
        if (update.includes('$2')) await bindUserRead(c, foreign);
        await bindRideMutation(c, ride, 'transition');
        await c.query(
          `UPDATE rides SET ${update} WHERE id=$1`,
          update.includes('$2') ? [ride, foreign] : [ride],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });
});
test('payment scope cannot change lifecycle and expiry cannot cancel an assigned trip', async () => {
  for (const kind of ['payment', 'expiry'] as const)
    await expect(
      transaction(runtime, async (c) => {
        await bindRideRead(c, ride);
        await bindRideMutation(c, ride, kind);
        await c.query("UPDATE rides SET state='cancelled',version=version+1 WHERE id=$1", [ride]);
      }),
    ).rejects.toMatchObject({ code: '42501' });
});
test('creation matches the validated quote and cannot substitute a cheaper fare', async () => {
  const id = randomUUID();
  const place = {
    id: 'synthetic',
    label: 'Synthetic place',
    area: 'Raleigh',
    coordinate: { latitude: 35.8, longitude: -78.6 },
  };
  const quote = {
    id,
    riderId: foreign,
    pickup: place,
    destination: place,
    service: 'standard',
    distanceMeters: 1000,
    durationSeconds: 300,
    fare: { amount: 1000, currency: 'USD' },
    estimatedDriverEarnings: { amount: 750, currency: 'USD' },
    rateVersion: 'synthetic',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  await db.pool.query('INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,$3,$4)', [
    id,
    foreign,
    quote,
    quote.expiresAt,
  ]);
  const deadline = new Date(Date.now() + 180000);
  await expect(
    actorTransaction(runtime, { id: foreign, role: 'rider' }, async (c) => {
      await bindRideCreation(c, quote, deadline);
      await c.query(
        'INSERT INTO rides(quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,1,750,$3)',
        [id, foreign, deadline],
      );
    }),
  ).rejects.toMatchObject({ code: '42501' });
  await actorTransaction(runtime, { id: foreign, role: 'rider' }, async (c) => {
    await bindRideCreation(c, quote, deadline);
    expect(
      (
        await c.query(
          'INSERT INTO rides(quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,1000,750,$3) RETURNING id',
          [id, foreign, deadline],
        )
      ).rowCount,
    ).toBe(1);
  });
});

test('restricted expiry sweeps only overdue searches and preserves assigned trips', async () => {
  const { SearchExpiry } = await import('./search-expiry');
  const quote = randomUUID();
  const expired = randomUUID();
  await db.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
    quote,
    foreign,
  ]);
  await db.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,1000,750,now()-interval '1 minute')",
    [expired, quote, foreign],
  );
  expect(await new SearchExpiry(runtime).sweep()).toBe(1);
  expect((await db.pool.query('SELECT state FROM rides WHERE id=$1', [expired])).rows[0].state).toBe(
    'cancelled',
  );
  expect((await db.pool.query('SELECT state FROM rides WHERE id=$1', [ride])).rows[0].state).toBe('matched');
  expect((await runtime.query('SELECT * FROM rides')).rowCount).toBe(0);
});

test('assigned driver completes the versioned ride lifecycle with the restricted runtime role', async () => {
  await db.pool.query("UPDATE rides SET payment_state='authorized' WHERE id=$1", [ride]);
  const service = new RideService(runtime);
  const actor = { id: driver, role: 'driver' as const };
  let version = 1;
  for (const state of ['en_route', 'arrived', 'in_progress', 'completed'] as const) {
    const key = randomUUID();
    const result = await service.transition(actor, ride, state, version, key);
    expect(result.state).toBe(state);
    expect(result.version).toBe(version + 1);
    expect(await service.transition(actor, ride, state, version, key)).toEqual(result);
    version = result.version;
  }
});

test('restricted lifecycle rejects an unrelated driver and preserves the active-rider guard', async () => {
  const other = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1,$2,'Synthetic other driver','driver')",
    [other, other],
  );
  await db.pool.query('INSERT INTO drivers(id) VALUES($1)', [other]);
  await db.pool.query("UPDATE rides SET payment_state='authorized' WHERE id=$1", [ride]);
  const service = new RideService(runtime);
  await expect(
    service.transition({ id: other, role: 'driver' }, ride, 'en_route', 1, randomUUID()),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [rider]);
  await expect(
    service.transition({ id: driver, role: 'driver' }, ride, 'en_route', 1, randomUUID()),
  ).rejects.toThrow('Active ride requires active rider');
  expect((await db.pool.query('SELECT state,version FROM rides WHERE id=$1', [ride])).rows[0]).toEqual({
    state: 'matched',
    version: 1,
  });
});
