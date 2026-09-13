import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, test, expect } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { actorTransaction } from './actor-transaction';
import { transaction } from './transactions';
import { requireStaffPermission } from './staff-access';
let db: Awaited<ReturnType<typeof testDatabase>>, pool: Pool;
let staff: { id: string; role: 'staff'; mfa: true }, other: string;
beforeAll(async () => {
  db = await testDatabase();
  await db.pool.query("CREATE ROLE rls_staff LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'synthetic-local-only'");
  await db.pool.query('GRANT USAGE ON SCHEMA public TO rls_staff');
  await db.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rls_staff');
  pool = new Pool({
    host: '127.0.0.1',
    port: (await db.pool.query('SELECT inet_server_port() AS port')).rows[0].port,
    database: 'postgres',
    user: 'rls_staff',
    password: 'synthetic-local-only',
    max: 2,
  });
}, 60000);
afterAll(async () => {
  await pool?.end();
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  other = randomUUID();
  for (const id of [staff.id, other])
    await db.pool.query("INSERT INTO users(id,subject,name,role) VALUES($1,$2,'Synthetic staff','staff')", [
      id,
      'synthetic:' + id,
    ]);
  await db.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.read'),($2,'privacy.close')",
    [staff.id, other],
  );
});
test('verified permission checks use owned locked rows and leave no pooled identity', async () => {
  expect((await pool.query('SELECT * FROM staff_permissions')).rowCount).toBe(0);
  await expect(
    transaction(pool, (c) => requireStaffPermission(c, staff, 'privacy.read')),
  ).resolves.toBeUndefined();
  await actorTransaction(pool, staff, async (c) => {
    expect((await c.query('SELECT permission FROM staff_permissions FOR SHARE')).rows).toEqual([
      { permission: 'privacy.read' },
    ]);
    expect((await c.query('SELECT * FROM staff_permissions WHERE staff_id=$1', [other])).rowCount).toBe(0);
    expect((await c.query('DELETE FROM staff_permissions')).rowCount).toBe(0);
  });
  expect((await pool.query('SELECT * FROM staff_permissions')).rowCount).toBe(0);
});
test('runtime cannot grant or edit staff permissions', async () => {
  await expect(
    actorTransaction(pool, staff, (c) =>
      c.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.close')", [staff.id]),
    ),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    actorTransaction(pool, staff, (c) => c.query("UPDATE staff_permissions SET permission='privacy.close'")),
  ).rejects.toMatchObject({ code: '42501' });
});
test('MFA, role, disabled status and current permission are required', async () => {
  await expect(
    transaction(pool, (c) => requireStaffPermission(c, { ...staff, mfa: false }, 'privacy.read')),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    transaction(pool, (c) => requireStaffPermission(c, { ...staff, role: 'driver' }, 'privacy.read')),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    transaction(pool, (c) => requireStaffPermission(c, staff, 'privacy.close')),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await db.pool.query('DELETE FROM staff_permissions WHERE staff_id=$1', [staff.id]);
  await expect(
    transaction(pool, (c) => requireStaffPermission(c, staff, 'privacy.read')),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [staff.id]);
  await expect(
    transaction(pool, (c) => requireStaffPermission(c, staff, 'privacy.read')),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
