import { actorTransaction } from './actor-transaction';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, test, expect } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { users } from '@rove/database';
import type { Actor } from './rides';
import { AccountDeletions } from './account-deletions';
import { SupportService } from './support';
let runtimePool: Pool;
let db: Awaited<ReturnType<typeof testDatabase>>;
let service: AccountDeletions, support: SupportService;
let rider: Actor, driver: Actor, staff: Actor;
const input = {
  category: 'account',
  message: 'Please delete my synthetic account.',
  deletionConsent: 'account-deletion-v1',
};
beforeAll(async () => {
  db = await testDatabase();
  await db.pool.query(
    "CREATE ROLE rls_support LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'synthetic-local-only'",
  );
  await db.pool.query('GRANT USAGE ON SCHEMA public TO rls_support');
  await db.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rls_support');
  await db.pool.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO rls_support');
  runtimePool = new Pool({
    host: '127.0.0.1',
    port: (await db.pool.query('SELECT inet_server_port() AS port')).rows[0].port,
    database: 'postgres',
    user: 'rls_support',
    password: 'synthetic-local-only',
    max: 5,
  });
  service = new AccountDeletions(runtimePool);
  support = new SupportService(runtimePool);
}, 60000);
afterAll(async () => {
  await runtimePool?.end();
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

test('explicit consent and ticket commit once across concurrent and lost-response retries', async () => {
  const key = randomUUID();
  const replies = await Promise.all([
    support.create(rider, input, key),
    support.create(rider, input, key),
    support.create(rider, input, randomUUID()),
  ]);
  expect(new Set(replies.map((r) => r.id)).size).toBe(1);
  expect((await service.status(rider)).request).toMatchObject({
    supportRequestId: replies[0]!.id,
    consentVersion: 'account-deletion-v1',
    state: 'requested',
  });
  expect((await db.pool.query('SELECT id FROM account_deletion_requests')).rowCount).toBe(1);
  expect(
    (await db.pool.query("SELECT id FROM audit WHERE action='account_deletion.requested'")).rowCount,
  ).toBe(1);
  expect((await service.status(driver)).request).toBeNull();
  expect((await db.pool.query('SELECT disabled FROM users WHERE id=$1', [rider.id])).rows[0].disabled).toBe(
    false,
  );
});

test('matching support prose and staff resolution never imply consent or erasure', async () => {
  const ticket = await support.create(
    rider,
    { category: input.category, message: input.message },
    randomUUID(),
  );
  expect((await service.status(rider)).request).toBeNull();
  await db.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'support.read'),($1,'support.resolve')",
    [staff.id],
  );
  await support.resolve(staff, ticket.id, { response: 'Synthetic support response only.' }, randomUUID());
  expect((await service.status(rider)).request).toBeNull();
  await support.create(rider, input, randomUUID());
  const before = await service.status(rider);
  await support.resolve(
    staff,
    before.request!.supportRequestId,
    { response: 'Synthetic review remains outstanding.' },
    randomUUID(),
  );
  expect(await service.status(rider)).toEqual(before);
});

test('explicit consent can upgrade an existing account ticket but cannot reuse a different command payload', async () => {
  const key = randomUUID();
  const ordinary = { category: input.category, message: input.message };
  const ticket = await support.create(driver, ordinary, key);
  await expect(support.create(driver, input, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect((await service.status(driver)).request).toBeNull();
  expect((await support.create(driver, input, randomUUID())).id).toBe(ticket.id);
  expect((await service.status(driver)).request!.supportRequestId).toBe(ticket.id);
});

test('consumer ownership, roles, disabled accounts and dedicated staff MFA/permission are enforced', async () => {
  await expect(support.create(rider, { ...input, category: 'payment' }, randomUUID())).rejects.toMatchObject({
    code: 'INVALID_DELETION_REQUEST',
  });
  await expect(support.create(staff, input, randomUUID())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await support.create(rider, input, randomUUID());
  const id = (await service.status(rider)).request!.id;
  for (const actor of [rider, driver, staff])
    await expect(service.inspect(actor, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.read')", [
    staff.id,
  ]);
  await expect(service.inspect({ ...staff, mfa: false }, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await service.inspect(staff, id)).request!.id).toBe(id);
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [rider.id]);
  await expect(service.status(rider)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(service.status({ ...driver, role: 'rider' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('database forbids rewriting or deleting consent and cross-owner or non-account ticket bindings', async () => {
  const ticket = await support.create(rider, input, randomUUID());
  await expect(
    db.pool.query('UPDATE account_deletion_requests SET owner_id=$1', [driver.id]),
  ).rejects.toThrow('immutable');
  await expect(db.pool.query('DELETE FROM account_deletion_requests')).rejects.toThrow('immutable');
  await expect(
    db.pool.query(
      "INSERT INTO account_deletion_requests(owner_id,support_request_id,consent_version) VALUES($1,$2,'account-deletion-v1')",
      [driver.id, ticket.id],
    ),
  ).rejects.toThrow('consumer account ticket');
  const other = await support.create(
    driver,
    { category: 'payment', message: 'Synthetic payment question.' },
    randomUUID(),
  );
  await expect(
    db.pool.query(
      "INSERT INTO account_deletion_requests(owner_id,support_request_id,consent_version) VALUES($1,$2,'account-deletion-v1')",
      [driver.id, other.id],
    ),
  ).rejects.toThrow('consumer account ticket');
});

test('audit failure rolls back the support ticket, consent and idempotency record together', async () => {
  await db.pool.query(
    `CREATE FUNCTION reject_deletion_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='account_deletion.requested' THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_deletion_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_deletion_audit();`,
  );
  try {
    await expect(support.create(rider, input, randomUUID())).rejects.toThrow('synthetic audit outage');
    for (const table of ['account_deletion_requests', 'support_requests', 'commands'])
      expect((await db.pool.query(`SELECT id FROM ${table}`)).rowCount).toBe(0);
  } finally {
    await db.pool.query('DROP TRIGGER reject_deletion_audit ON audit; DROP FUNCTION reject_deletion_audit()');
  }
});

test('withdrawal preserves consent, is retry-safe, and requires fresh consent to request again', async () => {
  const originalKey = randomUUID();
  const ticket = await support.create(rider, input, originalKey);
  const original = (await service.status(rider)).request!;
  const key = randomUUID();
  const results = await Promise.all([
    service.withdraw(rider, original.id, key),
    service.withdraw(rider, original.id, key),
    service.withdraw(rider, original.id, randomUUID()),
  ]);
  expect(results.every((r) => r.request?.state === 'withdrawn')).toBe(true);
  expect(
    (await db.pool.query("SELECT id FROM audit WHERE action='account_deletion.withdrawn'")).rowCount,
  ).toBe(1);
  await expect(db.pool.query('UPDATE account_deletion_requests SET withdrawn_at=NULL')).rejects.toThrow(
    'immutable',
  );
  await expect(
    db.pool.query('UPDATE account_deletion_requests SET withdrawn_at=clock_timestamp()'),
  ).rejects.toThrow('immutable');
  expect((await support.create(rider, input, originalKey)).id).toBe(ticket.id);
  expect((await service.status(rider)).request?.state).toBe('withdrawn');
  const fresh = await support.create(rider, input, randomUUID());
  expect(fresh.id).not.toBe(ticket.id);
  expect((await service.status(rider)).request).toMatchObject({
    state: 'requested',
    supportRequestId: fresh.id,
  });
  // Replaying the old withdrawal cannot cancel the new consent.
  await service.withdraw(rider, original.id, key);
  expect((await service.status(rider)).request?.supportRequestId).toBe(fresh.id);
  expect((await db.pool.query('SELECT id FROM account_deletion_requests')).rowCount).toBe(2);
});

test('withdrawal is owner-only, rejects disabled replays, and rolls back if audit fails', async () => {
  await support.create(rider, input, randomUUID());
  const id = (await service.status(rider)).request!.id;
  await expect(service.withdraw(driver, id, randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(service.withdraw(staff, id, randomUUID())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const key = randomUUID();
  await db.pool.query(
    `CREATE FUNCTION reject_withdrawal_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='account_deletion.withdrawn' THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_withdrawal_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_withdrawal_audit();`,
  );
  try {
    await expect(service.withdraw(rider, id, key)).rejects.toThrow('synthetic audit outage');
    expect((await service.status(rider)).request?.state).toBe('requested');
  } finally {
    await db.pool.query(
      'DROP TRIGGER reject_withdrawal_audit ON audit; DROP FUNCTION reject_withdrawal_audit()',
    );
  }
  await service.withdraw(rider, id, key);
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [rider.id]);
  await expect(service.withdraw(rider, id, key)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('inventory is owner-scoped, content-free and never claims erasure', async () => {
  await support.create(rider, input, randomUUID());
  await support.create(driver, input, randomUUID());
  const id = (await service.status(rider)).request!.id;
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.read')", [
    staff.id,
  ]);
  await db.pool.query(
    "INSERT INTO saved_places(rider_id,kind,place_id) VALUES($1,'home','sensitive-place-reference')",
    [rider.id],
  );
  await db.pool.query(
    "INSERT INTO retention_holds(owner_id,kind,reason_reference,review_at,placed_by) VALUES($1,'privacy','private-case',now()+interval '1 day',$2)",
    [rider.id, staff.id],
  );
  const result = await service.inventory(staff, id);
  expect(result).toMatchObject({
    requestId: id,
    withdrawn: false,
    accessClosed: false,
    identityRemoved: false,
    activeHoldCount: 1,
    completeErasureVerified: false,
    counts: {
      authoredMessages: 0,
      savedPlaces: 1,
      pushInstallations: 0,
      supportRequests: 1,
      documentReservations: 0,
    },
  });
  expect(JSON.stringify(result)).not.toMatch(/sensitive-place-reference|private-case|synthetic account/);
  expect(
    (
      await db.pool.query(
        "SELECT id FROM audit WHERE action='account_deletion.inventory_viewed' AND aggregate_id=$1",
        [id],
      )
    ).rowCount,
  ).toBe(1);
  expect((await db.pool.query('SELECT id FROM saved_places WHERE rider_id=$1', [rider.id])).rowCount).toBe(1);
});
test('inventory requires current permission and MFA and distinguishes missing requests', async () => {
  await support.create(rider, input, randomUUID());
  const id = (await service.status(rider)).request!.id;
  for (const actor of [rider, driver, staff])
    await expect(service.inventory(actor, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.read')", [
    staff.id,
  ]);
  await expect(service.inventory({ ...staff, mfa: false }, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(service.inventory(staff, randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await service.withdraw(rider, id, randomUUID());
  expect(await service.inventory(staff, id)).toMatchObject({
    withdrawn: true,
    completeErasureVerified: false,
  });
  await db.pool.query('DELETE FROM staff_permissions WHERE staff_id=$1', [staff.id]);
  await expect(service.inventory(staff, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
test('inventory cannot return unaudited evidence', async () => {
  await support.create(rider, input, randomUUID());
  const id = (await service.status(rider)).request!.id;
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.read')", [
    staff.id,
  ]);
  await db.pool.query(
    "CREATE FUNCTION reject_inventory_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='account_deletion.inventory_viewed' THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_inventory_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_inventory_audit();",
  );
  try {
    await expect(service.inventory(staff, id)).rejects.toThrow('synthetic audit outage');
  } finally {
    await db.pool.query(
      'DROP TRIGGER reject_inventory_audit ON audit; DROP FUNCTION reject_inventory_audit()',
    );
  }
});

test('RLS isolates consent and forbids staff withdrawal or consumer deletion', async () => {
  await support.create(rider, input, randomUUID());
  const id = (await service.status(rider)).request!.id;
  expect((await runtimePool.query('SELECT * FROM account_deletion_requests')).rowCount).toBe(0);
  await actorTransaction(runtimePool, driver, async (c) => {
    expect((await c.query('SELECT * FROM account_deletion_requests')).rowCount).toBe(0);
    expect(
      (await c.query('UPDATE account_deletion_requests SET withdrawn_at=clock_timestamp()')).rowCount,
    ).toBe(0);
  });
  await actorTransaction(runtimePool, rider, async (c) => {
    expect((await c.query('DELETE FROM account_deletion_requests WHERE id=$1', [id])).rowCount).toBe(0);
  });
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.close')", [
    staff.id,
  ]);
  await actorTransaction(runtimePool, staff, async (c) => {
    expect((await c.query('SELECT * FROM account_deletion_requests')).rowCount).toBe(1);
    expect(
      (await c.query('UPDATE account_deletion_requests SET withdrawn_at=clock_timestamp()')).rowCount,
    ).toBe(0);
  });
  await actorTransaction(runtimePool, { ...staff, mfa: false }, async (c) => {
    expect((await c.query('SELECT * FROM account_deletion_requests')).rowCount).toBe(0);
  });
  await service.withdraw(rider, id, randomUUID());
  expect((await service.status(rider)).request?.state).toBe('withdrawn');
});
