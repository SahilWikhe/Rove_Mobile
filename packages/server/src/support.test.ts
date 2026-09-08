import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { users } from '@rove/database';
import { SupportService } from './support';
import type { Actor } from './rides';
let db: Awaited<ReturnType<typeof testDatabase>>, service: SupportService;
let rider: Actor, driver: Actor, staff: Actor;
const input = { category: 'vehicle', message: 'Synthetic vehicle review question' };
beforeAll(async () => {
  db = await testDatabase();
  service = new SupportService(db.pool);
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  rider = { id: randomUUID(), role: 'rider' };
  driver = { id: randomUUID(), role: 'driver' };
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  await db.db
    .insert(users)
    .values([rider, driver, staff].map(({ id, role }) => ({ id, role, subject: id, name: 'Synthetic' })));
});
test('submission retry records one request and one audit, with owner-only history', async () => {
  const key = randomUUID();
  const results = await Promise.all([service.create(driver, input, key), service.create(driver, input, key)]);
  expect(results[0]).toEqual(results[1]);
  expect((await service.list(driver)).requests).toEqual([results[0]]);
  expect((await service.list(rider)).requests).toEqual([]);
  expect((await db.pool.query("SELECT id FROM audit WHERE action='support.created'")).rowCount).toBe(1);
  expect(JSON.stringify((await db.pool.query('SELECT metadata FROM audit')).rows)).not.toContain(
    input.message,
  );
  await expect(
    service.create(driver, { ...input, message: 'Changed request details' }, key),
  ).rejects.toThrow();
});
test('concurrent submissions cannot exceed the per-account open request cap', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, index) =>
      service.create(rider, { ...input, message: input.message + index }, randomUUID()),
    ),
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
  for (const result of results)
    if (result.status === 'rejected') expect(result.reason.code).toBe('SUPPORT_LIMIT');
  expect((await service.list(rider)).requests).toHaveLength(5);
  await expect(service.create(driver, input, randomUUID())).resolves.toMatchObject({ status: 'open' });
});
test('disabled accounts cannot create, list or replay and roles cannot be forged', async () => {
  const key = randomUUID();
  await service.create(rider, input, key);
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [rider.id]);
  await expect(service.create(rider, input, key)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(service.list(rider)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(service.create(staff, input, randomUUID())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(service.create({ ...driver, role: 'rider' }, input, randomUUID())).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
test('staff reads require MFA and support permission and record access', async () => {
  const request = await service.create(driver, input, randomUUID());
  await expect(service.inspect(staff, request.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'support.read')", [
    staff.id,
  ]);
  await expect(service.inspect({ ...staff, mfa: false }, request.id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(service.inspect(rider, request.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await service.inspect(staff, request.id)).toEqual(request);
  expect((await db.pool.query("SELECT id FROM audit WHERE action='support.viewed'")).rowCount).toBe(1);
  await db.pool.query('DELETE FROM staff_permissions WHERE staff_id=$1', [staff.id]);
  await expect(service.inspect(staff, request.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
test('invalid and ownership-spoofing payloads cannot persist', async () => {
  for (const raw of [
    { ...input, ownerId: rider.id },
    { ...input, status: 'resolved' },
    { ...input, message: 'short' },
    { ...input, message: 'x'.repeat(2001) },
    { ...input, category: 'admin' },
  ])
    await expect(service.create(driver, raw, randomUUID())).rejects.toThrow();
  expect((await service.list(driver)).requests).toEqual([]);
});
test('a failed audit rolls back request and idempotency result together', async () => {
  await db.pool.query(
    "ALTER TABLE audit ADD CONSTRAINT support_audit_fixture CHECK(action <> 'support.created')",
  );
  const key = randomUUID();
  try {
    await expect(service.create(rider, input, key)).rejects.toThrow();
  } finally {
    await db.pool.query('ALTER TABLE audit DROP CONSTRAINT support_audit_fixture');
  }
  expect((await service.list(rider)).requests).toEqual([]);
  expect((await db.pool.query('SELECT * FROM commands')).rowCount).toBe(0);
  await expect(service.create(rider, input, key)).resolves.toMatchObject({ status: 'open' });
});
