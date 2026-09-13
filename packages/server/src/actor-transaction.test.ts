import { AccountClosures } from './account-closures';
import { AccountDeletions } from './account-deletions';
import { SupportService } from './support';
import { SavedPlaceService } from './saved-places';
import type { MapsProvider } from './quotes';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { actorTransaction } from './actor-transaction';
import type { Actor } from './rides';
let db: Awaited<ReturnType<typeof testDatabase>>, pool: Pool;
const alice: Actor = { id: randomUUID(), role: 'rider' };
const bob: Actor = { id: randomUUID(), role: 'rider' };
const staff: Actor = { id: randomUUID(), role: 'staff', mfa: true };
const driver: Actor = { id: randomUUID(), role: 'driver' };
beforeAll(async () => {
  db = await testDatabase();
  for (const actor of [alice, bob, driver, staff])
    await db.pool.query('INSERT INTO users(id,subject,name,role) VALUES($1,$2,$3,$4)', [
      actor.id,
      actor.id,
      'Synthetic',
      actor.role,
    ]);
  await db.pool.query(
    "INSERT INTO saved_places(rider_id,kind,place_id) VALUES($1,'home','alice-home'),($2,'home','bob-home')",
    [alice.id, bob.id],
  );
  await db.pool.query(
    "CREATE ROLE rls_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'synthetic-local-only'",
  );
  await db.pool.query('GRANT USAGE ON SCHEMA public TO rls_runtime');
  await db.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rls_runtime');
  await db.pool.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO rls_runtime');
  expect(
    (
      await db.pool.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.saved_places'::regclass",
      )
    ).rows[0],
  ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  pool = new Pool({
    host: '127.0.0.1',
    port: (await db.pool.query('SELECT inet_server_port() AS port')).rows[0].port,
    password: 'synthetic-local-only',
    database: 'postgres',
    user: 'rls_runtime',
    max: 1,
  });
}, 60000);
afterAll(async () => {
  await pool?.end();
  await db?.close();
});

test('restricted role sees only its owner rows and cannot insert, update or delete another rider data', async () => {
  expect((await pool.query('SELECT * FROM saved_places')).rows).toEqual([]);
  await actorTransaction(pool, alice, async (c) => {
    expect((await c.query('SELECT place_id FROM saved_places')).rows).toEqual([{ place_id: 'alice-home' }]);
    expect(
      (await c.query("UPDATE saved_places SET place_id='changed' WHERE rider_id=$1", [bob.id])).rowCount,
    ).toBe(0);
    expect((await c.query('DELETE FROM saved_places WHERE rider_id=$1', [bob.id])).rowCount).toBe(0);
  });
  await expect(
    actorTransaction(pool, alice, (c) =>
      c.query("INSERT INTO saved_places(rider_id,kind,place_id) VALUES($1,'work','foreign')", [bob.id]),
    ),
  ).rejects.toMatchObject({ code: '42501' });
  expect((await actorTransaction(pool, driver, (c) => c.query('SELECT * FROM saved_places'))).rows).toEqual(
    [],
  );
});

test('pooled identities are isolated after commit, rollback and interleaved requests', async () => {
  const results = await Promise.all(
    [alice, bob, alice, bob].map((actor) =>
      actorTransaction(pool, actor, async (c) => {
        await c.query('SELECT pg_sleep(0.005)');
        return (await c.query('SELECT rider_id FROM saved_places')).rows;
      }),
    ),
  );
  expect(results.map((rows) => rows.map((r) => r.rider_id))).toEqual([
    [alice.id],
    [bob.id],
    [alice.id],
    [bob.id],
  ]);
  await expect(
    actorTransaction(pool, alice, async (c) => {
      await c.query("UPDATE saved_places SET place_id='rollback' WHERE rider_id=$1", [alice.id]);
      throw new Error('synthetic failure');
    }),
  ).rejects.toThrow('synthetic failure');
  expect((await pool.query('SELECT * FROM saved_places')).rows).toEqual([]);
  expect(
    (await actorTransaction(pool, alice, (c) => c.query('SELECT place_id FROM saved_places'))).rows,
  ).toEqual([{ place_id: 'alice-home' }]);
});

test('forged role, missing account and disabled account never reach scoped work', async () => {
  for (const actor of [
    { ...alice, role: 'staff' as const },
    { ...alice, id: randomUUID() },
  ])
    await expect(actorTransaction(pool, actor, async () => 'should not run')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [bob.id]);
  try {
    await expect(actorTransaction(pool, bob, async () => 'should not run')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  } finally {
    await db.pool.query('UPDATE users SET disabled=false WHERE id=$1', [bob.id]);
  }
});

test('saved-place service reads and changes work under actual owner RLS and serialize first writes', async () => {
  const maps = {
    resolve: async (id: string) => ({
      id,
      label: 'Synthetic',
      area: 'Fixture',
      coordinate: { latitude: 35, longitude: -78 },
    }),
  } as MapsProvider;
  const service = new SavedPlaceService(pool, maps);
  expect((await service.list(alice)).places).toEqual([{ kind: 'home', placeId: 'alice-home' }]);
  expect((await service.resolve(bob, 'home')).id).toBe('bob-home');
  await Promise.all([
    service.update(alice, 'work', 'alice-work', null),
    service.update(alice, 'work', 'alice-work', null),
  ]);
  expect((await service.list(alice)).places).toHaveLength(2);
  await service.remove(alice, 'work', 'alice-work');
  expect((await service.list(bob)).places).toEqual([{ kind: 'home', placeId: 'bob-home' }]);
});

test('deployed policies enforce staff MFA and read-only privacy permission', async () => {
  const read = (actor: Actor) => actorTransaction(pool, actor, (c) => c.query('SELECT id FROM saved_places'));
  expect((await read(staff)).rowCount).toBe(0);
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.read')", [
    staff.id,
  ]);
  expect((await read({ ...staff, mfa: false })).rowCount).toBe(0);
  expect((await read(staff)).rowCount).toBe(2);
  expect((await actorTransaction(pool, staff, (c) => c.query('DELETE FROM saved_places'))).rowCount).toBe(0);
  await db.pool.query('DELETE FROM staff_permissions WHERE staff_id=$1', [staff.id]);
  expect((await read(staff)).rowCount).toBe(0);
});

test('staff inventory and reviewed closure work under migrated RLS without granting active-owner deletion', async () => {
  await db.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.read'),($1,'privacy.close')",
    [staff.id],
  );
  expect(
    (
      await actorTransaction(pool, staff, (c) =>
        c.query('DELETE FROM saved_places WHERE rider_id=$1', [bob.id]),
      )
    ).rowCount,
  ).toBe(0);
  await new SupportService(pool).create(
    bob,
    { category: 'account', message: 'Synthetic closure', deletionConsent: 'account-deletion-v1' },
    randomUUID(),
  );
  const deletions = new AccountDeletions(pool);
  const request = (await deletions.status(bob)).request!;
  expect((await deletions.inventory(staff, request.id)).counts.savedPlaces).toBe(1);
  await new AccountClosures(
    pool,
    { erase: async () => ({ status: 'absent' }) },
    'synthetic-policy',
  ).authorize(
    staff,
    request.id,
    { policyReference: 'synthetic-policy', reviewReference: 'synthetic-review' },
    randomUUID(),
  );
  expect((await deletions.inventory(staff, request.id)).counts.savedPlaces).toBe(0);
  expect((await new SavedPlaceService(pool, {} as MapsProvider).list(alice)).places).toHaveLength(1);
  await expect(
    actorTransaction(pool, bob, (c) => c.query('SELECT * FROM saved_places')),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
