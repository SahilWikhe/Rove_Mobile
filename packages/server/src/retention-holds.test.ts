import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, test, expect, vi } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { users } from '@rove/database';
import type { Actor } from './rides';
import { RetentionHolds } from './retention-holds';
import { AccountClosures } from './account-closures';
import { AccountDeletions } from './account-deletions';
import { SupportService } from './support';
let db: Awaited<ReturnType<typeof testDatabase>>, holds: RetentionHolds, closures: AccountClosures;
let rider: Actor, other: Actor, staff: Actor;
const input = { kind: 'legal', reasonReference: 'synthetic-case-1', reviewAt: '2020-01-01T00:00:00.000Z' };
const policy = { policyReference: 'synthetic-policy', reviewReference: 'synthetic-review' };
const erase = vi.fn(async (_subject: string) => ({ status: 'absent' as const }));
beforeAll(async () => {
  db = await testDatabase();
  holds = new RetentionHolds(db.pool);
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users,outbox CASCADE');
  erase.mockReset().mockResolvedValue({ status: 'absent' });
  closures = new AccountClosures(db.pool, { erase }, policy.policyReference);
  rider = { id: randomUUID(), role: 'rider' };
  other = { id: randomUUID(), role: 'driver' };
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  await db.db
    .insert(users)
    .values([rider, other, staff].map(({ id, role }) => ({ id, role, subject: id, name: 'Synthetic' })));
  for (const permission of ['privacy.read', 'privacy.hold', 'privacy.release-hold', 'privacy.close'])
    await db.pool.query('INSERT INTO staff_permissions(staff_id,permission) VALUES($1,$2)', [
      staff.id,
      permission,
    ]);
});
async function request() {
  await new SupportService(db.pool).create(
    rider,
    {
      category: 'account',
      message: 'Delete this synthetic account.',
      deletionConsent: 'account-deletion-v1',
    },
    randomUUID(),
  );
  return (await new AccountDeletions(db.pool).status(rider)).request!.id;
}

test('holds apply before consent, survive past review dates, and block closure until explicitly released', async () => {
  const hold = await holds.place(staff, rider.id, input, randomUUID());
  const id = await request();
  await expect(closures.authorize(staff, id, policy, randomUUID())).rejects.toMatchObject({
    code: 'RETENTION_HOLD',
  });
  expect((await holds.list(staff)).holds).toHaveLength(1);
  expect((await db.pool.query('SELECT disabled FROM users WHERE id=$1', [rider.id])).rows[0].disabled).toBe(
    false,
  );
  await holds.release(staff, hold.id, { releaseReference: 'synthetic-release' }, randomUUID());
  expect((await holds.list(staff)).holds).toHaveLength(0);
  expect((await holds.list(staff, { status: 'released' })).holds).toHaveLength(1);
  expect((await closures.authorize(staff, id, policy, randomUUID())).state).toBe('closed');
});

test('holds after closure prevent the provider call and database identity-completion writes', async () => {
  const id = await request();
  await closures.authorize(staff, id, policy, randomUUID());
  const hold = await holds.place(staff, rider.id, input, randomUUID());
  await expect(closures.removeIdentity(id)).rejects.toMatchObject({ code: 'RETENTION_HOLD' });
  expect(erase).not.toHaveBeenCalled();
  await expect(
    db.pool.query('UPDATE account_closures SET identity_removed_at=now() WHERE request_id=$1', [id]),
  ).rejects.toThrow('dispatch evidence');
  await holds.release(staff, hold.id, { releaseReference: 'synthetic-release' }, randomUUID());
  await closures.removeIdentity(id);
  expect(erase).toHaveBeenCalledTimes(1);
});

test('new holds report a dispatched identity request without waiting for or hiding its outcome', async () => {
  const id = await request();
  await closures.authorize(staff, id, policy, randomUUID());
  let started!: () => void, finish!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  erase.mockImplementationOnce(async () => {
    started();
    await gate;
    return { status: 'absent' };
  });
  const removal = closures.removeIdentity(id);
  await began;
  let receipt: Awaited<ReturnType<RetentionHolds['place']>> | undefined;
  const placement = holds.place(staff, rider.id, input, randomUUID()).then((value) => {
    receipt = value;
    return value;
  });
  try {
    await vi.waitFor(() => expect(receipt).toBeDefined(), { timeout: 2000, interval: 10 });
    expect(receipt!.identityAttemptedAt).not.toBeNull();
    expect(receipt!.identityRemovedAt).toBeNull();
    await expect(closures.removeIdentity(id)).rejects.toMatchObject({ code: 'RETENTION_HOLD' });
    expect(erase).toHaveBeenCalledTimes(1);
  } finally {
    finish();
  }
  await removal;
  await placement;
  expect((await holds.list(staff)).holds[0]!.identityRemovedAt).not.toBeNull();
});

test('separate MFA permissions, consumer targeting, strict input and immutable release evidence', async () => {
  for (const actor of [rider, { ...staff, mfa: false }])
    await expect(holds.place(actor, rider.id, input, randomUUID())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  await expect(holds.place(staff, staff.id, input, randomUUID())).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(holds.place(staff, rider.id, { ...input, ownerId: other.id }, randomUUID())).rejects.toThrow();
  const hold = await holds.place(staff, rider.id, input, randomUUID());
  await db.pool.query("DELETE FROM staff_permissions WHERE permission='privacy.release-hold'");
  await expect(
    holds.release(staff, hold.id, { releaseReference: 'synthetic-release' }, randomUUID()),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(holds.list(rider)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(db.pool.query('DELETE FROM retention_holds')).rejects.toThrow('immutable');
  await expect(db.pool.query('UPDATE retention_holds SET owner_id=$1', [other.id])).rejects.toThrow(
    'immutable',
  );
  await expect(
    db.pool.query('UPDATE retention_holds SET released_at=now(),released_by=$1', [staff.id]),
  ).rejects.toThrow('retention_hold_release');
  await db.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.release-hold')",
    [staff.id],
  );
  await holds.release(staff, hold.id, { releaseReference: 'synthetic-release' }, randomUUID());
  await expect(
    db.pool.query('UPDATE retention_holds SET released_at=NULL,released_by=NULL,release_reference=NULL'),
  ).rejects.toThrow('immutable');
});

test('concurrent duplicate cases and idempotency retries record one hold/audit and one release', async () => {
  const key = randomUUID();
  const results = await Promise.all([
    holds.place(staff, rider.id, input, key),
    holds.place(staff, rider.id, input, key),
    holds.place(staff, rider.id, input, randomUUID()),
  ]);
  expect(new Set(results.map((r) => r.id)).size).toBe(1);
  await expect(
    holds.place(staff, rider.id, { ...input, reviewAt: '2030-01-01T00:00:00.000Z' }, randomUUID()),
  ).rejects.toMatchObject({ code: 'RETENTION_HOLD_EXISTS' });
  const releaseKey = randomUUID();
  await holds.release(staff, results[0]!.id, { releaseReference: 'synthetic-release' }, releaseKey);
  await holds.release(staff, results[0]!.id, { releaseReference: 'synthetic-release' }, releaseKey);
  await expect(
    holds.release(staff, results[0]!.id, { releaseReference: 'different-review' }, randomUUID()),
  ).rejects.toMatchObject({ code: 'RETENTION_HOLD_RELEASED' });
  expect(
    (await db.pool.query("SELECT action FROM audit WHERE action IN ('retention.held','retention.released')"))
      .rowCount,
  ).toBe(2);
});

test('review queue pagination preserves microseconds and filters account/status without skipping rows', async () => {
  for (let i = 0; i < 52; i++)
    await holds.place(
      staff,
      rider.id,
      { ...input, reasonReference: 'case-' + i, reviewAt: '2030-01-01T00:00:00.123456Z' },
      randomUUID(),
    );
  await expect(
    holds.place(
      staff,
      rider.id,
      { ...input, reasonReference: 'case-0', reviewAt: '2030-01-01T00:00:00.123457Z' },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'RETENTION_HOLD_EXISTS' });
  const first = await holds.list(staff, { ownerId: rider.id });
  expect(first.holds).toHaveLength(50);
  expect(first.nextCursor?.afterReviewAt).toBe('2030-01-01T00:00:00.123456Z');
  const second = await holds.list(staff, { ownerId: rider.id, ...first.nextCursor });
  expect(second.holds).toHaveLength(2);
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.holds, ...second.holds].map((h) => h.id)).size).toBe(52);
  expect((await holds.list(staff, { ownerId: other.id })).holds).toHaveLength(0);
});

test('failed hold audit rolls back creation and command result', async () => {
  await db.pool.query(
    `CREATE FUNCTION fail_hold_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='retention.held' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_hold_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION fail_hold_audit();`,
  );
  try {
    await expect(holds.place(staff, rider.id, input, randomUUID())).rejects.toThrow(
      'synthetic audit failure',
    );
    expect((await db.pool.query('SELECT * FROM retention_holds')).rowCount).toBe(0);
    expect((await db.pool.query('SELECT * FROM commands')).rowCount).toBe(0);
  } finally {
    await db.pool.query('DROP TRIGGER fail_hold_audit ON audit; DROP FUNCTION fail_hold_audit()');
  }
});
