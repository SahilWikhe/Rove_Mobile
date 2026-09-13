import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { getRide, listRides } from './ride-queries';
let db: Awaited<ReturnType<typeof testDatabase>>;
let runtime: Pool;
let rider: string;
let otherRider: string;
let driver: string;
let otherDriver: string;
beforeAll(async () => {
  db = await testDatabase();
  const password = randomBytes(32).toString('hex');
  await db.pool.query(`CREATE ROLE ride_reader LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
  await db.pool.query(
    'GRANT USAGE ON SCHEMA public TO ride_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO ride_reader; GRANT UPDATE ON users TO ride_reader',
  );
  const connection = new URL(db.connectionString);
  connection.username = 'ride_reader';
  connection.password = password;
  runtime = new Pool({ connectionString: connection.toString(), max: 2 });
}, 60000);
afterAll(async () => {
  await runtime?.end();
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  rider = randomUUID();
  otherRider = randomUUID();
  driver = randomUUID();
  otherDriver = randomUUID();
  for (const [id, role] of [
    [rider, 'rider'],
    [otherRider, 'rider'],
    [driver, 'driver'],
    [otherDriver, 'driver'],
  ]) {
    await db.pool.query(
      "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Private fixture name',$2)",
      [id, role],
    );
    if (role === 'driver') await db.pool.query('INSERT INTO drivers(id) VALUES($1)', [id]);
  }
});
async function trip(owner = rider, assigned = driver, time = '2026-09-07T12:00:00.123456Z') {
  const id = randomUUID();
  const quoteId = randomUUID();
  const place = {
    id: 'fixture',
    label: 'Private exact address',
    area: 'Raleigh',
    coordinate: { latitude: 35.8, longitude: -78.6 },
  };
  const quote = {
    id: quoteId,
    riderId: owner,
    pickup: place,
    destination: place,
    service: 'standard',
    distanceMeters: 1000,
    durationSeconds: 300,
    fare: { amount: 1050, currency: 'USD' },
    estimatedDriverEarnings: { amount: 790, currency: 'USD' },
    rateVersion: 'fixture',
    expiresAt: '2026-09-07T12:00:00.000Z',
  };
  await db.pool.query('INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,$3,now())', [
    quoteId,
    owner,
    quote,
  ]);
  await db.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,driver_id,state,fare_cents,earnings_cents,search_deadline,created_at) VALUES($1,$2,$3,$4,'completed',1050,790,now(),$5)",
    [id, quoteId, owner, assigned, time],
  );
  return id;
}
test('history pages preserve timestamp ties without dropping or duplicating rides', async () => {
  const ids = [];
  for (let i = 0; i < 25; i++) ids.push(await trip());
  const actor = { id: rider, role: 'rider' as const };
  const first = await listRides(runtime, actor);
  expect(first.rides).toHaveLength(20);
  expect(first.nextCursor).toBe(first.rides.at(-1)?.id);
  const second = await listRides(runtime, actor, first.nextCursor!);
  expect(second.rides).toHaveLength(5);
  expect(second.nextCursor).toBeNull();
  const found = [...first.rides, ...second.rides].map((ride) => ride.id);
  expect(new Set(found).size).toBe(25);
  expect(found).toEqual(ids.sort().reverse());
});
test('a newer insertion does not shift an existing continuation window', async () => {
  for (let i = 0; i < 21; i++) await trip();
  const actor = { id: rider, role: 'rider' as const };
  const first = await listRides(runtime, actor);
  const newer = await trip(rider, driver, '2026-09-08T12:00:00Z');
  const second = await listRides(runtime, actor, first.nextCursor!);
  expect(second.rides).toHaveLength(1);
  expect(first.rides.map((ride) => ride.id)).not.toContain(second.rides[0]!.id);
  expect(second.rides.map((ride) => ride.id)).not.toContain(newer);
  expect((await listRides(runtime, actor)).rides[0]!.id).toBe(newer);
});
test('foreign or missing cursors reveal no rides, and staff cannot use personal history', async () => {
  await trip();
  const foreign = await trip(otherRider, otherDriver);
  for (const before of [foreign, randomUUID()]) {
    expect(await listRides(runtime, { id: rider, role: 'rider' }, before)).toEqual({
      rides: [],
      nextCursor: null,
    });
    expect(await listRides(runtime, { id: driver, role: 'driver' }, before)).toEqual({
      rides: [],
      nextCursor: null,
    });
  }
  await expect(listRides(runtime, { id: rider, role: 'staff' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
test('driver history includes only assigned rides and retains post-trip redaction', async () => {
  const mine = await trip();
  await trip(otherRider, otherDriver);
  const page = await listRides(runtime, { id: driver, role: 'driver' });
  expect(page.rides.map((ride) => ride.id)).toEqual([mine]);
  expect(JSON.stringify(page)).not.toMatch(/Private fixture name|Private exact address|coordinate/);
  expect(page.rides[0]).not.toHaveProperty('rider');
  expect(page.rides[0]).not.toHaveProperty('pickup');
  expect((await listRides(runtime, { id: rider, role: 'rider' })).rides[0]).toHaveProperty('pickup');
});

test('old driver history survives counterpart profile expiry without identity exposure', async () => {
  const id = await trip();
  await db.pool.query("UPDATE rides SET updated_at=now()-interval '60 days' WHERE id=$1", [id]);
  const result = await getRide(runtime, { id: driver, role: 'driver' }, id);
  expect(result.id).toBe(id);
  expect(JSON.stringify(result)).not.toMatch(/Private fixture name|Private exact address|coordinate/);
});
test('active participants receive trip details while outsiders and disabled accounts are denied', async () => {
  const id = await trip();
  await db.pool.query("UPDATE rides SET state='matched' WHERE id=$1", [id]);
  expect(await getRide(runtime, { id: driver, role: 'driver' }, id)).toHaveProperty(
    'rider.name',
    'Private fixture name',
  );
  expect(await getRide(runtime, { id: rider, role: 'rider' }, id)).toHaveProperty(
    'driver.name',
    'Private fixture name',
  );
  await expect(getRide(runtime, { id: otherRider, role: 'rider' }, id)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(getRide(runtime, { id: otherDriver, role: 'driver' }, id)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [rider]);
  await expect(getRide(runtime, { id: rider, role: 'rider' }, id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect((await runtime.query('SELECT id FROM quotes')).rowCount).toBe(0);
  expect((await runtime.query('SELECT id FROM users')).rowCount).toBe(0);
});
