import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { bindUserRead } from './user-scope';
import { bindDriverMutation } from './driver-scope';
import { transaction } from './transactions';
import { DriverService } from './drivers';
let db: Awaited<ReturnType<typeof testDatabase>>;
let runtime: Pool;
let driver: string;
let other: string;
beforeAll(async () => {
  db = await testDatabase();
  const password = randomBytes(32).toString('hex');
  await db.pool.query(`CREATE ROLE driver_policy_probe LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
  await db.pool.query(
    'GRANT USAGE ON SCHEMA public TO driver_policy_probe; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO driver_policy_probe',
  );
  const connection = new URL(db.connectionString);
  connection.username = 'driver_policy_probe';
  connection.password = password;
  runtime = new Pool({ connectionString: connection.toString(), max: 1 });
}, 60000);
afterAll(async () => {
  await runtime?.end();
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  driver = randomUUID();
  other = randomUUID();
  for (const id of [driver, other]) {
    await db.pool.query(
      "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Synthetic','driver')",
      [id],
    );
    await db.pool.query('INSERT INTO drivers(id) VALUES($1)', [id]);
  }
});
test('unscoped access is denied and read scope permits locking but not writes or deletion', async () => {
  expect((await runtime.query('SELECT * FROM drivers')).rowCount).toBe(0);
  await transaction(runtime, async (c) => {
    await bindUserRead(c, driver);
    expect((await c.query('SELECT id FROM drivers FOR UPDATE')).rows).toEqual([{ id: driver }]);
    expect((await c.query('DELETE FROM drivers')).rowCount).toBe(0);
  });
  await expect(
    transaction(runtime, async (c) => {
      await bindUserRead(c, driver);
      await c.query('UPDATE drivers SET approved=true WHERE id=$1', [driver]);
    }),
  ).rejects.toMatchObject({ code: '42501' });
});
test('coverage command updates only the actor and preserves unrelated driver fields', async () => {
  const service = new DriverService(runtime);
  expect(await service.coverage({ id: driver, role: 'driver' }, 40, randomUUID())).toEqual({
    radiusMiles: 40,
  });
  expect(await service.profile({ id: driver, role: 'driver' })).toMatchObject({
    coverageRadiusMiles: 40,
    approved: false,
    online: false,
  });
  expect(
    (await db.pool.query('SELECT coverage_radius_miles FROM drivers WHERE id=$1', [other])).rows[0],
  ).toEqual({ coverage_radius_miles: 25 });
  expect((await runtime.query('SELECT * FROM drivers')).rowCount).toBe(0);
});
test('coverage and location scopes cannot grant approval or payout readiness', async () => {
  for (const kind of ['coverage', 'location'] as const) {
    await expect(
      transaction(runtime, async (c) => {
        await bindUserRead(c, driver);
        await bindDriverMutation(c, driver, kind);
        await c.query('UPDATE drivers SET approved=true,payout_ready=true WHERE id=$1', [driver]);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  }
});
test('a captured driver mutation cannot retarget another visible driver', async () => {
  await transaction(runtime, async (c) => {
    await bindUserRead(c, driver);
    await bindDriverMutation(c, driver, 'coverage');
    await c.query("SELECT set_config('rove.actor_id',$1,true)", [other]);
    expect((await c.query('UPDATE drivers SET coverage_radius_miles=50 WHERE id=$1', [other])).rowCount).toBe(
      0,
    );
    expect(
      (await c.query('UPDATE drivers SET coverage_radius_miles=50 WHERE id=$1', [driver])).rowCount,
    ).toBe(1);
  });
});
test('invalidation cannot approve a driver and identity rebinding clears mutation authority', async () => {
  await expect(
    transaction(runtime, async (c) => {
      await bindUserRead(c, driver);
      await bindDriverMutation(c, driver, 'invalidate');
      await c.query('UPDATE drivers SET approved=true WHERE id=$1', [driver]);
    }),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    transaction(runtime, async (c) => {
      await bindUserRead(c, driver);
      await bindDriverMutation(c, driver, 'coverage');
      await bindUserRead(c, other);
      await c.query('UPDATE drivers SET coverage_radius_miles=60 WHERE id=$1', [other]);
    }),
  ).rejects.toMatchObject({ code: '42501' });
});
