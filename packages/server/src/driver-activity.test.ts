import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { DriverService } from './drivers';
let db: Awaited<ReturnType<typeof testDatabase>>;
let service: DriverService;
let driverId: string;
beforeAll(async () => {
  db = await testDatabase();
  service = new DriverService(db.pool);
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  driverId = await driver();
});
async function driver() {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,subject,name,role,created_at) VALUES($1::uuid,$1::text,'Synthetic','driver','2026-01-15T00:00:00Z')",
    [id],
  );
  await db.pool.query('INSERT INTO drivers(id) VALUES($1)', [id]);
  return id;
}
async function ride(owner: string, state: string, offer: string) {
  const rider = randomUUID(),
    quote = randomUUID(),
    ride = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Synthetic rider','rider')",
    [rider],
  );
  await db.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
    quote,
    rider,
  ]);
  await db.pool.query(
    'INSERT INTO rides(id,quote_id,rider_id,driver_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,$4,$5,1000,750,now())',
    [ride, quote, rider, owner, state],
  );
  await db.pool.query(
    "INSERT INTO offers(ride_id,driver_id,status,expires_at,snapshot) VALUES($1,$2,$3,now(),'{}')",
    [ride, owner, offer],
  );
}
test('new drivers have real zero totals and their recorded registration date', async () => {
  expect(await service.activity({ id: driverId, role: 'driver' })).toEqual({
    completedTrips: 0,
    acceptedOffers: 0,
    joinedAt: '2026-01-15T00:00:00.000Z',
  });
});
test('counts only owned completed rides and accepted offers without conflating payment or cancellation', async () => {
  await ride(driverId, 'completed', 'accepted');
  await ride(driverId, 'completed', 'accepted');
  await ride(driverId, 'cancelled', 'accepted');
  await ride(driverId, 'no_driver_found', 'expired');
  await ride(driverId, 'cancelled', 'declined');
  await ride(await driver(), 'completed', 'accepted');
  expect(await service.activity({ id: driverId, role: 'driver' })).toMatchObject({
    completedTrips: 2,
    acceptedOffers: 3,
  });
});
test('rejects other roles and hides missing or disabled driver accounts', async () => {
  for (const role of ['rider', 'staff'] as const)
    await expect(service.activity({ id: driverId, role })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(service.activity({ id: randomUUID(), role: 'driver' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [driverId]);
  await expect(service.activity({ id: driverId, role: 'driver' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});
