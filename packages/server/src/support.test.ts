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

async function grantResolution() {
  await db.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'support.read'),($1,'support.resolve')",
    [staff.id],
  );
}
test('only an MFA staff resolver can publish a response; the owner sees no staff identity', async () => {
  const request = await service.create(driver, input, randomUUID());
  const reply = { response: 'Synthetic review instructions for the driver' };
  await expect(service.resolve(driver, request.id, reply, randomUUID())).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'support.read')", [
    staff.id,
  ]);
  await expect(service.resolve(staff, request.id, reply, randomUUID())).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'support.resolve')", [
    staff.id,
  ]);
  await expect(
    service.resolve({ ...staff, mfa: false }, request.id, reply, randomUUID()),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const key = randomUUID();
  const result = await service.resolve(staff, request.id, reply, key);
  expect(result).toMatchObject({ status: 'resolved', response: reply.response });
  expect(result.resolvedAt).toBeTruthy();
  expect(await service.resolve(staff, request.id, reply, key)).toEqual(result);
  expect((await service.list(driver)).requests).toEqual([result]);
  expect((await service.list(rider)).requests).toEqual([]);
  expect(result).not.toHaveProperty('resolvedBy');
  expect((await db.pool.query("SELECT id FROM audit WHERE action='support.resolved'")).rowCount).toBe(1);
  await db.pool.query("DELETE FROM staff_permissions WHERE staff_id=$1 AND permission='support.resolve'", [
    staff.id,
  ]);
  await expect(service.resolve(staff, request.id, reply, key)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
test('competing resolutions preserve exactly one public response', async () => {
  await grantResolution();
  const request = await service.create(rider, input, randomUUID());
  const results = await Promise.allSettled([
    service.resolve(staff, request.id, { response: 'Synthetic first resolution' }, randomUUID()),
    service.resolve(staff, request.id, { response: 'Synthetic second resolution' }, randomUUID()),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { code: 'SUPPORT_RESOLVED' },
  });
  const winning = results.find((result) => result.status === 'fulfilled');
  if (winning?.status === 'fulfilled') expect((await service.list(rider)).requests[0]).toEqual(winning.value);
});
test('resolution frees open-request capacity and audit failure leaves the request open', async () => {
  await grantResolution();
  const requests = [];
  for (let i = 0; i < 5; i++)
    requests.push(await service.create(rider, { ...input, message: input.message + i }, randomUUID()));
  await db.pool.query(
    "ALTER TABLE audit ADD CONSTRAINT support_resolve_audit_fixture CHECK(action <> 'support.resolved')",
  );
  const key = randomUUID(),
    request = requests[0]!;
  try {
    await expect(
      service.resolve(staff, request.id, { response: 'Synthetic response' }, key),
    ).rejects.toThrow();
  } finally {
    await db.pool.query('ALTER TABLE audit DROP CONSTRAINT support_resolve_audit_fixture');
  }
  expect((await service.inspect(staff, request.id)).status).toBe('open');
  expect((await service.inspect(staff, request.id)).response).toBeNull();
  await service.resolve(staff, request.id, { response: 'Synthetic response' }, key);
  await expect(
    service.create(rider, { ...input, message: 'Synthetic additional question' }, randomUUID()),
  ).resolves.toMatchObject({ status: 'open' });
});

test('staff queue pages tied and sub-millisecond timestamps without leaking messages', async () => {
  await grantResolution();
  // More than one page of synthetic rows, including precision JavaScript Date cannot retain.
  await db.pool.query(
    "INSERT INTO support_requests(owner_id,category,message,created_at) SELECT $1,'account','Synthetic private message','2026-09-08T08:00:00.000123Z'::timestamptz + (n/3)*interval '1 microsecond' FROM generate_series(1,55) n",
    [rider.id],
  );
  const expected = (await db.pool.query('SELECT id FROM support_requests ORDER BY created_at,id')).rows.map(
    (row) => row.id,
  );
  const first = await service.queue(staff);
  expect(first.requests).toHaveLength(50);
  expect(first.nextCursor).not.toBeNull();
  expect(first.requests[0]).not.toHaveProperty('message');
  expect(first.requests[0]).not.toHaveProperty('ownerId');
  // Removing the cursor row from the open queue must not invalidate its cursor.
  await service.resolve(staff, first.requests.at(-1)!.id, { response: 'Synthetic resolution' }, randomUUID());
  const second = await service.queue(staff, first.nextCursor!);
  expect(second.requests).toHaveLength(5);
  expect(second.nextCursor).toBeNull();
  expect([...first.requests, ...second.requests].map((row) => row.id)).toEqual(expected);
  const resolved = await service.queue(staff, { status: 'resolved' });
  expect(resolved.requests.map((row) => row.id)).toEqual([first.requests.at(-1)!.id]);
  const audits = (await db.pool.query("SELECT metadata FROM audit WHERE action='support.queue_viewed'")).rows;
  expect(audits).toHaveLength(3);
  expect(JSON.stringify(audits)).not.toContain('Synthetic private');
});
test('queue permission, MFA, filters and cursor are enforced', async () => {
  await expect(service.queue(staff)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await grantResolution();
  await expect(service.queue({ ...staff, mfa: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(service.queue(driver)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  for (const query of [
    { status: 'any' },
    { afterId: randomUUID() },
    { afterCreatedAt: '2026-09-08T08:00:00Z' },
    { afterCreatedAt: 'bad', afterId: randomUUID() },
    { ownerId: rider.id },
    { limit: 999 },
  ])
    await expect(service.queue(staff, query)).rejects.toMatchObject({ code: 'INVALID_QUERY' });
  expect((await db.pool.query("SELECT id FROM audit WHERE action='support.queue_viewed'")).rowCount).toBe(0);
  expect(await service.queue(staff)).toEqual({ requests: [], nextCursor: null });
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [staff.id]);
  await expect(service.queue(staff)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
