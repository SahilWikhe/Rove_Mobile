import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { getDriverLocation } from './driver-location-queries';
let db: Awaited<ReturnType<typeof testDatabase>>;
let rider: string, other: string, driver: string, ride: string;
const now = new Date('2026-09-08T12:00:00Z');
const coordinate = { latitude: 35.78, longitude: -78.64 };
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  rider = randomUUID();
  other = randomUUID();
  driver = randomUUID();
  ride = randomUUID();
  for (const [id, role] of [
    [rider, 'rider'],
    [other, 'rider'],
    [driver, 'driver'],
  ])
    await db.pool.query(
      "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Private name',$2)",
      [id, role],
    );
  await db.pool.query(
    'INSERT INTO drivers(id,online,location,location_at,location_sampled_at) VALUES($1,true,$2,$3,$3)',
    [driver, coordinate, now],
  );
  const quote = randomUUID();
  await db.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',$3)", [
    quote,
    rider,
    now,
  ]);
  await db.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,driver_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,$4,'matched',1000,750,$5)",
    [ride, quote, rider, driver, now],
  );
});
const read = (time = now) => getDriverLocation(db.pool, { id: rider, role: 'rider' }, ride, time);
test('only the assigned ride owner receives a bounded location sample without identity details', async () => {
  expect(await read()).toEqual({
    rideId: ride,
    location: {
      coordinate,
      sampledAt: now.toISOString(),
      expiresAt: '2026-09-08T12:01:00.000Z',
      validForMs: 60000,
    },
  });
  for (const actor of [
    { id: other, role: 'rider' as const },
    { id: driver, role: 'driver' as const },
    { id: rider, role: 'staff' as const },
  ])
    await expect(getDriverLocation(db.pool, actor, ride, now)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
test('old, future, missing and malformed samples return no coordinates', async () => {
  expect((await read(new Date(now.getTime() + 60000))).location).toBeNull();
  expect((await read(new Date(now.getTime() - 5001))).location).toBeNull();
  await db.pool.query('UPDATE drivers SET location_sampled_at=NULL WHERE id=$1', [driver]);
  expect((await read()).location).toBeNull();
  await db.pool.query('UPDATE drivers SET location_sampled_at=$2,location=$3 WHERE id=$1', [
    driver,
    now,
    { latitude: 999, longitude: 0 },
  ]);
  expect((await read()).location).toBeNull();
});
test('offline or disabled drivers do not expose location', async () => {
  await db.pool.query('UPDATE drivers SET online=false WHERE id=$1', [driver]);
  expect((await read()).location).toBeNull();
  await db.pool.query('UPDATE drivers SET online=true WHERE id=$1', [driver]);
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [driver]);
  expect((await read()).location).toBeNull();
});
test('ending or removing an assignment immediately revokes further reads', async () => {
  await db.pool.query("UPDATE rides SET state='completed' WHERE id=$1", [ride]);
  await expect(read()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await db.pool.query("UPDATE rides SET state='searching',driver_id=NULL WHERE id=$1", [ride]);
  await expect(read()).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
