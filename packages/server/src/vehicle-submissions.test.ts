import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { users, drivers } from '@rove/database';
import { VehicleSubmissionService } from './vehicle-submissions';
let db: Awaited<ReturnType<typeof testDatabase>>;
let service: VehicleSubmissionService;
let actor: { id: string; role: 'driver' };
const vehicle = {
  make: 'Test',
  model: 'Fixture',
  year: 2025,
  color: 'Black',
  plate: 'DEMO',
  registrationRegion: 'NC',
  requestedService: 'accessible',
};
beforeAll(async () => {
  db = await testDatabase();
  service = new VehicleSubmissionService(db.pool);
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  actor = { id: randomUUID(), role: 'driver' };
  await db.db.insert(users).values({ ...actor, subject: actor.id, name: 'Synthetic driver' });
  await db.db.insert(drivers).values({
    id: actor.id,
    approved: true,
    payoutReady: true,
    eligibilityExpiresAt: new Date(Date.now() + 86400000),
    vehicle: { make: 'Previously approved' },
    service: 'standard',
  });
});
test('submission clears approval and tracking without changing the effective vehicle or service', async () => {
  await db.pool.query(
    "INSERT INTO driver_tracking_sessions(driver_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [actor.id, 'fixture-hash'],
  );
  const result = await service.submit(actor, { vehicle, expectedRevision: null });
  expect(result.submission).toMatchObject({ vehicle, status: 'pending' });
  expect(
    (
      await db.pool.query(
        'SELECT approved,payout_ready,eligibility_expires_at,vehicle,service FROM drivers WHERE id=$1',
        [actor.id],
      )
    ).rows[0],
  ).toEqual({
    approved: false,
    payout_ready: true,
    eligibility_expires_at: null,
    vehicle: { make: 'Previously approved' },
    service: 'standard',
  });
  expect((await db.pool.query('SELECT * FROM driver_tracking_sessions')).rowCount).toBe(0);
  expect(
    (await db.pool.query("SELECT metadata FROM audit WHERE action='driver.vehicle_submitted'")).rows[0]
      .metadata,
  ).toEqual({ revision: result.submission?.revision });
});
test('concurrent submissions serialize and reject stale competing edits; identical retry is safe', async () => {
  const results = await Promise.allSettled([
    service.submit(actor, { vehicle, expectedRevision: null }),
    service.submit(actor, { vehicle: { ...vehicle, color: 'White' }, expectedRevision: null }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'VEHICLE_CHANGED' } });
  const current = (await service.get(actor)).submission!;
  expect(
    (await service.submit(actor, { vehicle: current.vehicle, expectedRevision: null })).submission?.revision,
  ).toBe(current.revision);
  expect((await db.pool.query("SELECT id FROM audit WHERE action='driver.vehicle_submitted'")).rowCount).toBe(
    1,
  );
});
test('online drivers cannot change a vehicle', async () => {
  await db.pool.query('UPDATE drivers SET online=true WHERE id=$1', [actor.id]);
  await expect(service.submit(actor, { vehicle, expectedRevision: null })).rejects.toMatchObject({
    code: 'GO_OFFLINE',
  });
  expect((await service.get(actor)).submission).toBeNull();
});
test('riders and staff cannot submit and a driver cannot choose approval fields', async () => {
  for (const role of ['rider', 'staff'] as const) {
    await expect(
      service.submit({ ...actor, role }, { vehicle, expectedRevision: null }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.get({ ...actor, role })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }
  await expect(service.submit(actor, { vehicle, expectedRevision: null, approved: true })).rejects.toThrow();
  await expect(
    service.submit(actor, { vehicle: { ...vehicle, approved: true }, expectedRevision: null }),
  ).rejects.toThrow();
});
test('submission reads are scoped to the driver and disabled drivers cannot submit', async () => {
  await service.submit(actor, { vehicle, expectedRevision: null });
  const other = { id: randomUUID(), role: 'driver' as const };
  await db.db.insert(users).values({ ...other, subject: other.id, name: 'Other driver' });
  await db.db.insert(drivers).values({ id: other.id });
  expect((await service.get(other)).submission).toBeNull();
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [other.id]);
  await expect(service.submit(other, { vehicle, expectedRevision: null })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});

test.each(['matched', 'en_route', 'arrived', 'in_progress', 'interrupted'])(
  'an offline driver with a %s ride cannot change vehicles',
  async (state) => {
    const riderId = randomUUID(),
      quoteId = randomUUID();
    await db.db
      .insert(users)
      .values({ id: riderId, subject: riderId, name: 'Synthetic rider', role: 'rider' });
    await db.pool.query(
      "INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now()+interval '1 minute')",
      [quoteId, riderId],
    );
    await db.pool.query(
      'INSERT INTO rides(quote_id,rider_id,driver_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,$4,1000,700,now())',
      [quoteId, riderId, actor.id, state],
    );
    await expect(service.submit(actor, { vehicle, expectedRevision: null })).rejects.toMatchObject({
      code: 'ACTIVE_TRIP',
    });
    expect((await service.get(actor)).submission).toBeNull();
    expect(
      (await db.pool.query('SELECT approved FROM drivers WHERE id=$1', [actor.id])).rows[0].approved,
    ).toBe(true);
  },
);

test('editing a submission preserves each submitted revision and retries do not duplicate history', async () => {
  const first = (await service.submit(actor, { vehicle, expectedRevision: null })).submission!;
  const changed = { ...vehicle, color: 'White' };
  const second = (await service.submit(actor, { vehicle: changed, expectedRevision: first.revision }))
    .submission!;
  await service.submit(actor, { vehicle: changed, expectedRevision: first.revision });
  const rows = (
    await db.pool.query('SELECT revision,vehicle FROM driver_vehicle_history WHERE driver_id=$1', [actor.id])
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.revision === first.revision)?.vehicle).toEqual(vehicle);
  expect(rows.find((row) => row.revision === second.revision)?.vehicle).toEqual(changed);
  expect((await service.get(actor)).submission?.revision).toBe(second.revision);
  await expect(
    db.pool.query("UPDATE driver_vehicle_history SET vehicle='{}' WHERE revision=$1", [first.revision]),
  ).rejects.toThrow('Submitted vehicle revisions cannot be edited');
});
test('a failed audit write rolls back the submission, history and approval changes together', async () => {
  await db.pool.query(
    "ALTER TABLE audit ADD CONSTRAINT reject_vehicle_audit_fixture CHECK(action <> 'driver.vehicle_submitted')",
  );
  try {
    await expect(service.submit(actor, { vehicle, expectedRevision: null })).rejects.toThrow();
    expect((await service.get(actor)).submission).toBeNull();
    expect((await db.pool.query('SELECT revision FROM driver_vehicle_history')).rowCount).toBe(0);
    expect(
      (await db.pool.query('SELECT approved FROM drivers WHERE id=$1', [actor.id])).rows[0].approved,
    ).toBe(true);
  } finally {
    await db.pool.query('ALTER TABLE audit DROP CONSTRAINT reject_vehicle_audit_fixture');
  }
});

test('history migration backfills the current submission from the previous schema', async () => {
  const current = (await service.submit(actor, { vehicle, expectedRevision: null })).submission!;
  // Recreate the pre-0013 state inside this disposable test database.
  await db.pool.query(
    'ALTER TABLE vehicle_review_decisions DROP CONSTRAINT vehicle_review_decisions_revision_driver_vehicle_history_revision_fk',
  );
  await db.pool.query('DROP TABLE driver_vehicle_history; DROP FUNCTION prevent_vehicle_history_update()');
  const migration = await readFile(
    new URL('../../database/migrations/0013_vehicle_submission_history.sql', import.meta.url),
    'utf8',
  );
  await db.pool.query(migration);
  await db.pool.query(
    'ALTER TABLE vehicle_review_decisions ADD CONSTRAINT vehicle_review_decisions_revision_driver_vehicle_history_revision_fk FOREIGN KEY(revision) REFERENCES driver_vehicle_history(revision) ON DELETE CASCADE',
  );
  const row = (
    await db.pool.query(
      'SELECT revision,vehicle,submitted_at FROM driver_vehicle_history WHERE driver_id=$1',
      [actor.id],
    )
  ).rows[0];
  expect(row.revision).toBe(current.revision);
  expect(row.vehicle).toEqual(vehicle);
  expect(row.submitted_at.toISOString()).toBe(current.submittedAt);
});
