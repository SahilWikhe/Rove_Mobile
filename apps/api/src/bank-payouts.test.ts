import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import {
  BankPayouts,
  QuoteService,
  RideService,
  developmentRates,
  type BankPayoutProvider,
  type MapsProvider,
} from '@rove/server';
import { createApp } from './app';
let db: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
test('authenticated HTTP payout history cannot select another driver account and is private', async () => {
  const driver = randomUUID(),
    rider = randomUUID();
  for (const [id, role] of [
    [driver, 'driver'],
    [rider, 'rider'],
  ])
    await db.pool.query("INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$2,'Fixture',$2)", [
      id,
      role,
    ]);
  await db.pool.query('INSERT INTO drivers(id) VALUES($1)', [driver]);
  await db.pool.query(
    "INSERT INTO driver_payout_accounts(driver_id,source,account_id) VALUES($1,'acct_platform:test','acct_driver')",
    [driver],
  );
  const list = vi.fn<BankPayoutProvider['list']>(async () => ({ items: [], nextCursor: null }));
  const maps: MapsProvider = {
    search: async () => [],
    resolve: async () => {
      throw new Error('unused');
    },
    route: async () => ({ distanceMeters: 1, durationSeconds: 1 }),
  };
  const deps = {
    flags: async () => {
      throw new Error('unused');
    },
    pool: db.pool,
    rides: new RideService(db.pool),
    quotes: new QuoteService(db.pool, maps, developmentRates, { south: 35, north: 37, west: -80, east: -77 }),
    maps,
    verifyIdentity: async (subject: string) => ({ subject }),
  };
  const path = '/v1/drivers/me/payout-history';
  const disabled = createApp(deps);
  expect((await disabled.request(path)).status).toBe(401);
  expect((await disabled.request(path, { headers: { Authorization: 'Bearer rider' } })).status).toBe(403);
  expect(
    await (await disabled.request(path, { headers: { Authorization: 'Bearer driver' } })).json(),
  ).toMatchObject({ status: 'unavailable' });
  const app = createApp({ ...deps, bankPayouts: new BankPayouts(db.pool, 'acct_platform:test', { list }) });
  const response = await app.request(path + '?accountId=acct_other', {
    headers: { Authorization: 'Bearer driver' },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(await response.json()).toMatchObject({ status: 'available', items: [] });
  expect(list.mock.calls[0]?.[0]).toMatchObject({ driverId: driver, accountId: 'acct_driver' });
  expect(
    (await app.request(path + '?after=acct_other', { headers: { Authorization: 'Bearer driver' } })).status,
  ).toBe(400);
});
