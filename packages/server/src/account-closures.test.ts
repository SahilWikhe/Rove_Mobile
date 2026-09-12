import { recordCapturedFunds } from './ledger';
import { transaction } from './transactions';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, test, expect, vi } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { users, drivers } from '@rove/database';
import { AccountClosures } from './account-closures';
import { SupportService } from './support';
import { AccountDeletions } from './account-deletions';
import { OutboxWorker } from './outbox';
import { RideService, type Actor } from './rides';
let db: Awaited<ReturnType<typeof testDatabase>>, service: AccountClosures;
let rider: Actor, driver: Actor, staff: Actor;
const erase = vi.fn(async (_subject: string) => ({ status: 'absent' as const }));
const policy = { policyReference: 'synthetic-policy-v1', reviewReference: 'synthetic-review-1' };
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users,outbox CASCADE');
  erase.mockReset().mockResolvedValue({ status: 'absent' });
  service = new AccountClosures(db.pool, { erase }, policy.policyReference);
  rider = { id: randomUUID(), role: 'rider' };
  driver = { id: randomUUID(), role: 'driver' };
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  await db.db.insert(users).values(
    [rider, driver, staff].map(({ id, role }) => ({
      id,
      role,
      subject: 'https://synthetic.auth0.com/|auth0|' + id,
      name: 'Synthetic',
    })),
  );
  await db.db.insert(drivers).values({
    id: driver.id,
    online: true,
    location: { latitude: 35, longitude: -78 },
    locationAt: new Date(),
  });
  await db.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.close'),($1,'privacy.read')",
    [staff.id],
  );
});
async function request(actor = rider) {
  await new SupportService(db.pool).create(
    actor,
    {
      category: 'account',
      message: 'Please delete this synthetic account.',
      deletionConsent: 'account-deletion-v1',
    },
    randomUUID(),
  );
  return (await new AccountDeletions(db.pool).status(actor)).request!.id;
}
async function quote() {
  return (
    await db.pool.query(
      "INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($2,$1,'{}',now()+interval '1 hour') RETURNING id",
      [rider.id, randomUUID()],
    )
  ).rows[0].id as string;
}

test('closure is authorized once and atomically revokes local driver access before outbox identity removal', async () => {
  const requestId = await request(driver);
  await db.pool.query(
    "INSERT INTO driver_tracking_sessions(driver_id,token_hash,expires_at) VALUES($1,'synthetic-hash',now()+interval '1 hour')",
    [driver.id],
  );
  await db.pool.query(
    "INSERT INTO push_installations(project_id,installation_id,secret_hash,owner_id,token,platform) VALUES($1,$2,'synthetic-hash',$3,'ExponentPushToken[synthetic]','ios')",
    [randomUUID(), randomUUID(), driver.id],
  );
  const key = randomUUID();
  const responses = await Promise.all([
    service.authorize(staff, requestId, policy, key),
    service.authorize(staff, requestId, policy, key),
  ]);
  expect(responses[0]).toEqual(responses[1]);
  expect(responses[0]!.state).toBe('closed');
  expect(erase).not.toHaveBeenCalled();
  expect((await db.pool.query('SELECT disabled FROM users WHERE id=$1', [driver.id])).rows[0].disabled).toBe(
    true,
  );
  expect(
    (await db.pool.query('SELECT online,location,location_at FROM drivers WHERE id=$1', [driver.id])).rows[0],
  ).toEqual({ online: false, location: null, location_at: null });
  expect((await db.pool.query('SELECT * FROM driver_tracking_sessions')).rowCount).toBe(0);
  expect((await db.pool.query('SELECT enabled,token FROM push_installations')).rows[0]).toEqual({
    enabled: false,
    token: '',
  });
  const worker = new OutboxWorker(db.pool, { 'account.identity-delete': service.handle });
  expect(await worker.runOnce()).toEqual({ processed: 1, failed: 0 });
  expect(erase).toHaveBeenCalledWith('https://synthetic.auth0.com/|auth0|' + driver.id);
  expect((await service.inspect(staff, requestId)).state).toBe('identity_removed');
  await service.removeIdentity(requestId);
  expect(erase).toHaveBeenCalledTimes(1);
  expect((await db.pool.query("SELECT id FROM audit WHERE action='account.closed'")).rowCount).toBe(1);
});

test('missing consent, consumer callers, missing MFA/permission and unapproved policy cannot close access', async () => {
  const id = await request();
  for (const actor of [rider, driver, { ...staff, mfa: false }])
    await expect(service.authorize(actor, id, policy, randomUUID())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  await expect(service.authorize(staff, randomUUID(), policy, randomUUID())).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(
    service.authorize(staff, id, { ...policy, policyReference: 'unapproved' }, randomUUID()),
  ).rejects.toMatchObject({ code: 'ACCOUNT_CLOSURE_POLICY' });
  await db.pool.query("DELETE FROM staff_permissions WHERE permission='privacy.close'");
  await expect(service.authorize(staff, id, policy, randomUUID())).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect((await db.pool.query('SELECT * FROM account_closures')).rowCount).toBe(0);
  expect(erase).not.toHaveBeenCalled();
});

test('active trip holds closure, including a booking committed while closure waits on its owner lock', async () => {
  const id = await request(),
    quoteId = await quote();
  const c = await db.pool.connect();
  await c.query('BEGIN');
  await c.query('SELECT id FROM users WHERE id=$1 FOR SHARE', [rider.id]);
  const closure = service.authorize(staff, id, policy, randomUUID()).catch((e: unknown) => e);
  try {
    await c.query(
      "INSERT INTO rides(quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,1000,700,now()+interval '1 minute')",
      [quoteId, rider.id],
    );
    await c.query('COMMIT');
  } finally {
    c.release();
  }
  expect(await closure).toMatchObject({ code: 'ACCOUNT_CLOSURE_HOLD' });
  expect((await db.pool.query('SELECT disabled FROM users WHERE id=$1', [rider.id])).rows[0].disabled).toBe(
    false,
  );
});

test('closed accounts cannot regain online state, change subject, or start new rides with stale identity', async () => {
  const id = await request(),
    quoteId = await quote();
  await service.authorize(staff, id, policy, randomUUID());
  await expect(new RideService(db.pool).request(rider, quoteId, randomUUID())).rejects.toMatchObject({
    code: 'ACCOUNT_DISABLED',
  });
  await expect(db.pool.query('UPDATE users SET disabled=false WHERE id=$1', [rider.id])).rejects.toThrow(
    'cannot be restored',
  );
  await expect(
    db.pool.query('UPDATE users SET subject=$2 WHERE id=$1', [rider.id, 'replacement']),
  ).rejects.toThrow('cannot be restored');
  await expect(
    db.pool.query(
      'INSERT INTO rides(quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,1000,700,now())',
      [quoteId, rider.id],
    ),
  ).rejects.toThrow('active rider');
  const driverId = await request(driver);
  await service.authorize(staff, driverId, policy, randomUUID());
  await expect(db.pool.query('UPDATE drivers SET online=true WHERE id=$1', [driver.id])).rejects.toThrow(
    'active account',
  );
  await expect(db.pool.query('DELETE FROM account_closures')).rejects.toThrow('immutable');
  await expect(db.pool.query("UPDATE account_closures SET policy_reference='replacement'")).rejects.toThrow(
    'immutable',
  );
});

test('pending payment authorization prevents closure even after the trip is terminal', async () => {
  const id = await request(),
    quoteId = await quote();
  const ride = (
    await db.pool.query(
      "INSERT INTO rides(quote_id,rider_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,'cancelled',1000,700,now()) RETURNING id",
      [quoteId, rider.id],
    )
  ).rows[0].id;
  const customer = (
    await db.pool.query(
      "INSERT INTO payment_customers(rider_id,source,customer_id) VALUES($1,'synthetic','cus_synthetic') RETURNING id",
      [rider.id],
    )
  ).rows[0].id;
  await db.pool.query(
    "INSERT INTO payment_attempts(ride_id,customer_binding_id,source,amount_cents,provider_status) VALUES($1,$2,'synthetic',1000,'requires_capture')",
    [ride, customer],
  );
  await expect(service.authorize(staff, id, policy, randomUUID())).rejects.toMatchObject({
    code: 'ACCOUNT_CLOSURE_HOLD',
  });
  await transaction(db.pool, async (c) => {
    const attempt = (
      await c.query("UPDATE payment_attempts SET provider_status='succeeded' WHERE ride_id=$1 RETURNING id", [
        ride,
      ])
    ).rows[0].id;
    await recordCapturedFunds(c, {
      attemptId: attempt,
      rideId: ride,
      riderId: rider.id,
      receivedCents: 1000,
      driverId: null,
      earningsCents: 0,
      completed: false,
      fullFare: true,
    });
  });
  await expect(service.authorize(staff, id, policy, randomUUID())).rejects.toMatchObject({
    code: 'ACCOUNT_CLOSURE_HOLD',
  });
});

test('unknown provider results never complete closure; retry recovers without another authorization', async () => {
  const id = await request();
  await service.authorize(staff, id, policy, randomUUID());
  erase.mockRejectedValueOnce(new Error('synthetic network timeout'));
  await expect(service.removeIdentity(id)).rejects.toThrow('synthetic network timeout');
  const uncertain = await service.inspect(staff, id);
  expect(uncertain.state).toBe('closed');
  expect(uncertain.identityAttemptedAt).not.toBeNull();
  expect(uncertain.identityRemovedAt).toBeNull();
  await expect(
    db.pool.query('UPDATE account_closures SET identity_attempted_at=NULL WHERE request_id=$1', [id]),
  ).rejects.toThrow('immutable');
  await service.removeIdentity(id);
  expect((await service.inspect(staff, id)).state).toBe('identity_removed');
  await expect(service.removeIdentity(randomUUID())).rejects.toMatchObject({
    code: 'ACCOUNT_CLOSURE_REQUIRED',
  });
});

test('audit failure rolls back account, tokens, closure and queued identity work', async () => {
  const id = await request();
  await db.pool.query(
    `CREATE FUNCTION fail_close_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='account.closed' THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_close_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION fail_close_audit();`,
  );
  try {
    await expect(service.authorize(staff, id, policy, randomUUID())).rejects.toThrow(
      'synthetic audit outage',
    );
    expect((await db.pool.query('SELECT disabled FROM users WHERE id=$1', [rider.id])).rows[0].disabled).toBe(
      false,
    );
    expect((await db.pool.query('SELECT * FROM account_closures')).rowCount).toBe(0);
    expect((await db.pool.query('SELECT * FROM outbox')).rowCount).toBe(0);
  } finally {
    await db.pool.query('DROP TRIGGER fail_close_audit ON audit; DROP FUNCTION fail_close_audit()');
  }
});

test('staff can replay a dead-letter identity job without changing closure or interrupting active work', async () => {
  const id = await request();
  await service.authorize(staff, id, policy, randomUUID());
  expect(await service.retryIdentity(staff, id, randomUUID())).toEqual({ requeued: false });
  await db.pool.query(
    "UPDATE outbox SET dead_letter_at=now(),attempts=8,last_error_code='PROVIDER_ERROR' WHERE aggregate_id=$1",
    [id],
  );
  await expect(service.retryIdentity(rider, id, randomUUID())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const key = randomUUID();
  expect(await service.retryIdentity(staff, id, key)).toEqual({ requeued: true });
  expect(await service.retryIdentity(staff, id, key)).toEqual({ requeued: true });
  expect(
    (
      await db.pool.query(
        "SELECT id FROM audit WHERE action='account.identity_retry' AND metadata->>'requeued'='true'",
      )
    ).rowCount,
  ).toBe(1);
  expect(await new OutboxWorker(db.pool, { 'account.identity-delete': service.handle }).runOnce()).toEqual({
    processed: 1,
    failed: 0,
  });
  expect(await service.retryIdentity(staff, id, randomUUID())).toEqual({ requeued: false });
});
