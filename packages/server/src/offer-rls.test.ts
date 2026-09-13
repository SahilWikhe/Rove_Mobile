import { MatchingService } from './matching';
import { DriverService } from './drivers';
import { RideService } from './rides';
import { bindActorIdentity } from './actor-transaction';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { createDatabase } from '@rove/database';
import { testDatabase } from '@rove/database/testing';
import { bindOfferRide } from './offer-scope';
import { transaction } from './transactions';
let db: Awaited<ReturnType<typeof testDatabase>>;
let runtime: ReturnType<typeof createDatabase>;
let actor: string;
beforeAll(async () => {
  db = await testDatabase();
  const password = randomBytes(32).toString('hex');
  await db.pool.query(`CREATE ROLE rls_offer LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
  await db.pool.query('GRANT USAGE ON SCHEMA public TO rls_offer');
  await db.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rls_offer');
  const connection = new URL(db.connectionString);
  connection.username = 'rls_offer';
  connection.password = password;
  runtime = createDatabase(connection.toString());
}, 60000);
afterAll(async () => {
  await runtime?.close();
  await db?.close();
});
let driver: string, other: string, ride: string, offer: string;
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  actor = randomUUID();
  driver = randomUUID();
  other = randomUUID();
  ride = randomUUID();
  offer = randomUUID();
  const quote = randomUUID();
  for (const [id, role] of [
    [actor, 'rider'],
    [driver, 'driver'],
    [other, 'driver'],
  ])
    await db.pool.query("INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Synthetic',$2)", [
      id,
      role,
    ]);
  for (const id of [driver, other]) await db.pool.query('INSERT INTO drivers(id) VALUES($1)', [id]);
  await db.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
    quote,
    actor,
  ]);
  await db.pool.query(
    'INSERT INTO rides(id,quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,1000,800,now())',
    [ride, quote, actor],
  );
  await db.pool.query(
    "INSERT INTO offers(id,ride_id,driver_id,snapshot,expires_at) VALUES($1,$2,$3,'{}',now())",
    [offer, ride, driver],
  );
});
test('drivers see only their own offers and riders see only accepted assignments', async () => {
  expect((await runtime.pool.query('SELECT * FROM offers')).rowCount).toBe(0);
  await transaction(runtime.pool, async (c) => {
    await bindActorIdentity(c, { id: other, role: 'driver' });
    expect((await c.query('SELECT * FROM offers')).rowCount).toBe(0);
    expect((await c.query("UPDATE offers SET status='declined'")).rowCount).toBe(0);
    await bindActorIdentity(c, { id: actor, role: 'rider' });
    expect((await c.query('SELECT * FROM offers')).rowCount).toBe(0);
    await bindActorIdentity(c, { id: driver, role: 'driver' });
    expect((await c.query('SELECT id FROM offers')).rows).toEqual([{ id: offer }]);
    expect((await c.query("UPDATE offers SET status='accepted' WHERE id=$1", [offer])).rowCount).toBe(1);
  });
  await db.pool.query("UPDATE rides SET driver_id=$2,state='matched' WHERE id=$1", [ride, driver]);
  await transaction(runtime.pool, async (c) => {
    await bindActorIdentity(c, { id: actor, role: 'rider' });
    expect((await c.query('SELECT id FROM offers')).rows).toEqual([{ id: offer }]);
    expect((await c.query('DELETE FROM offers')).rowCount).toBe(0);
  });
});
test('workers update only the scoped ride; notification scopes are read-only and exact', async () => {
  await transaction(runtime.pool, async (c) => {
    await bindOfferRide(c, randomUUID());
    expect((await c.query("UPDATE offers SET status='expired'")).rowCount).toBe(0);
    await bindOfferRide(c, ride);
    expect((await c.query("UPDATE offers SET status='expired'")).rowCount).toBe(1);
  });
  await transaction(runtime.pool, async (c) => {
    await c.query("SELECT set_config('rove.notification_offer',$1,true)", [offer]);
    expect((await c.query('SELECT id FROM offers')).rows).toEqual([{ id: offer }]);
    expect((await c.query("UPDATE offers SET status='revoked'")).rowCount).toBe(0);
  });
  await expect(
    transaction(runtime.pool, (c) =>
      c.query("INSERT INTO offers(ride_id,driver_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
        ride,
        other,
      ]),
    ),
  ).rejects.toMatchObject({ code: '42501' });
  await transaction(runtime.pool, async (c) => {
    await bindOfferRide(c, ride, true);
    await c.query("INSERT INTO offers(ride_id,driver_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
      ride,
      other,
    ]);
  });
  expect((await runtime.pool.query('SELECT * FROM offers')).rowCount).toBe(0);
});

test('restricted matching creates one private offer and its driver can accept it', async () => {
  const now = new Date();
  const until = new Date(now.getTime() + 60000);
  const place = {
    id: 'synthetic',
    label: 'Private synthetic address',
    area: 'Synthetic area',
    coordinate: { latitude: 35.8, longitude: -78.6 },
  };
  await db.pool.query('DELETE FROM offers WHERE id=$1', [offer]);
  const quote = (await db.pool.query('SELECT quote_id FROM rides WHERE id=$1', [ride])).rows[0].quote_id;
  const snapshot = {
    id: quote,
    riderId: actor,
    pickup: place,
    destination: place,
    service: 'standard',
    distanceMeters: 5000,
    durationSeconds: 600,
    fare: { amount: 1000, currency: 'USD' },
    estimatedDriverEarnings: { amount: 800, currency: 'USD' },
    rateVersion: 'synthetic',
    expiresAt: until.toISOString(),
  };
  await db.pool.query('UPDATE quotes SET snapshot=$2,expires_at=$3 WHERE id=$1', [
    quote,
    JSON.stringify(snapshot),
    until,
  ]);
  await db.pool.query(
    "UPDATE rides SET state='searching',payment_state='authorized',search_deadline=$2 WHERE id=$1",
    [ride, until],
  );
  await db.pool.query(
    'UPDATE drivers SET approved=true,online=true,payout_ready=true,payout_valid_until=$2,eligibility_expires_at=$2,location=$3,location_at=$4 WHERE id=$1',
    [driver, until, JSON.stringify(place.coordinate), now],
  );
  const matching = new MatchingService(
    runtime.pool,
    {
      search: async () => [],
      resolve: async () => place,
      route: async () => ({ durationSeconds: 180, distanceMeters: 1000 }),
    },
    () => now,
  );
  await Promise.all([matching.tick(ride), matching.tick(ride)]);
  const service = new DriverService(runtime.pool, () => now);
  const own = { id: driver, role: 'driver' as const };
  const received = (await service.offers(own)).offers;
  expect(received).toHaveLength(1);
  expect(JSON.stringify(received)).not.toContain(place.label);
  expect(JSON.stringify(received)).not.toContain('coordinate');
  expect((await service.offers({ id: other, role: 'driver' })).offers).toHaveLength(0);
  const rides = new RideService(runtime.pool, () => now);
  const key = randomUUID();
  const accepted = await rides.accept(own, received[0]!.id, key);
  expect(accepted.state).toBe('matched');
  expect(await rides.accept(own, received[0]!.id, key)).toEqual(accepted);
  expect((await db.pool.query('SELECT status FROM offers WHERE ride_id=$1', [ride])).rows).toEqual([
    { status: 'accepted' },
  ]);
  expect((await runtime.pool.query('SELECT id FROM offers')).rowCount).toBe(0);
});
