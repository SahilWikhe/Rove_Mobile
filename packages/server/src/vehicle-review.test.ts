import { beforeAll, beforeEach, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { users, drivers, staffPermissions } from '@rove/database';
import { VehicleSubmissionService } from './vehicle-submissions';
import { VehicleReviewService } from './vehicle-review';
let db: Awaited<ReturnType<typeof testDatabase>>;
let review: VehicleReviewService, submissions: VehicleSubmissionService;
let driver: { id: string; role: 'driver' },
  staff: { id: string; role: 'staff'; mfa: boolean },
  revision: string;
const vehicle = {
  make: 'Synthetic',
  model: 'Test',
  year: 2025,
  color: 'Black',
  plate: 'DEMO',
  registrationRegion: 'NC',
  requestedService: 'standard',
};
beforeAll(async () => {
  db = await testDatabase();
  review = new VehicleReviewService(db.pool);
  submissions = new VehicleSubmissionService(db.pool);
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  driver = { id: randomUUID(), role: 'driver' };
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  await db.db
    .insert(users)
    .values([driver, staff].map((actor) => ({ ...actor, subject: actor.id, name: 'Synthetic' })));
  await db.db.insert(drivers).values({ id: driver.id, payoutReady: true });
  revision = (await submissions.submit(driver, { vehicle, expectedRevision: null })).submission!.revision;
});
async function grant() {
  await db.db.insert(staffPermissions).values({ staffId: staff.id, permission: 'driver.vehicle.review' });
}
const approve = () => ({
  revision,
  decision: 'approved',
  verifiedService: 'standard',
  reason: 'Synthetic vehicle evidence checked',
});
test('staff role alone cannot view or decide; consumer actors cannot self-approve', async () => {
  for (const actor of [staff, driver]) {
    await expect(review.inspect(actor, driver.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(review.decide(actor, driver.id, approve(), randomUUID())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  }
  expect((await db.pool.query('SELECT id FROM vehicle_review_decisions')).rowCount).toBe(0);
});
test('permitted review is audited and vehicle approval does not enable driving', async () => {
  await grant();
  expect((await review.inspect(staff, driver.id)).revision).toBe(revision);
  const key = randomUUID();
  expect(await review.decide(staff, driver.id, approve(), key)).toEqual({ revision, status: 'approved' });
  expect(await review.decide(staff, driver.id, approve(), key)).toEqual({ revision, status: 'approved' });
  const row = (
    await db.pool.query('SELECT approved,eligibility_expires_at,vehicle,service FROM drivers WHERE id=$1', [
      driver.id,
    ])
  ).rows[0];
  expect(row).toEqual({
    approved: false,
    eligibility_expires_at: null,
    vehicle: { make: 'Synthetic', model: 'Test', color: 'Black', plate: 'DEMO' },
    service: 'standard',
  });
  expect((await db.pool.query('SELECT id FROM vehicle_review_decisions')).rowCount).toBe(1);
  expect((await db.pool.query("SELECT id FROM audit WHERE action='staff.vehicle_reviewed'")).rowCount).toBe(
    1,
  );
  await expect(db.pool.query("UPDATE vehicle_review_decisions SET decision='rejected'")).rejects.toThrow(
    'Vehicle review decisions cannot be edited',
  );
  await db.pool.query('DELETE FROM staff_permissions WHERE staff_id=$1', [staff.id]);
  await expect(review.decide(staff, driver.id, approve(), key)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
test('a replaced submission cannot be approved from an older review screen', async () => {
  await grant();
  await submissions.submit(driver, { vehicle: { ...vehicle, color: 'White' }, expectedRevision: revision });
  await expect(review.decide(staff, driver.id, approve(), randomUUID())).rejects.toMatchObject({
    code: 'REVIEW_CHANGED',
  });
});
test('competing reviewers cannot record two decisions for a revision', async () => {
  await grant();
  const outcomes = await Promise.allSettled([
    review.decide(staff, driver.id, approve(), randomUUID()),
    review.decide(
      staff,
      driver.id,
      {
        revision,
        decision: 'rejected',
        reason: 'Synthetic registration evidence missing',
        corrections: ['registration_not_verified'],
      },
      randomUUID(),
    ),
  ]);
  expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { code: 'REVIEW_CHANGED' },
  });
  expect((await db.pool.query('SELECT id FROM vehicle_review_decisions')).rowCount).toBe(1);
});
test('disabled reviewers and unrequested accessible capability are rejected', async () => {
  await grant();
  await expect(
    review.decide(staff, driver.id, { ...approve(), verifiedService: 'accessible' }, randomUUID()),
  ).rejects.toMatchObject({ code: 'INVALID_SERVICE' });
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [staff.id]);
  await expect(review.inspect(staff, driver.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('permission does not bypass missing MFA, including a recorded decision replay', async () => {
  await grant();
  const key = randomUUID();
  for (const actor of [
    { id: staff.id, role: staff.role },
    { ...staff, mfa: false },
  ]) {
    await expect(review.inspect(actor, driver.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(review.decide(actor, driver.id, approve(), key)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  }
  expect((await db.pool.query('SELECT id FROM audit WHERE actor_id=$1', [staff.id])).rowCount).toBe(0);
  expect((await db.pool.query('SELECT id FROM vehicle_review_decisions')).rowCount).toBe(0);
  await review.decide(staff, driver.id, approve(), key);
  await expect(review.decide({ ...staff, mfa: false }, driver.id, approve(), key)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});

test('drivers receive only correction categories for their current rejected revision', async () => {
  await grant();
  const corrections = ['vehicle_details_mismatch', 'registration_not_verified'];
  await review.decide(
    staff,
    driver.id,
    {
      revision,
      decision: 'rejected',
      reason: 'Private synthetic investigation note',
      corrections,
    },
    randomUUID(),
  );
  const visible = (await submissions.get(driver)).submission!;
  expect(visible.status).toBe('rejected');
  expect(visible.corrections).toEqual(corrections);
  expect(JSON.stringify(visible)).not.toContain('Private synthetic');
  expect(visible).not.toHaveProperty('reviewerId');
  expect((await submissions.get({ id: randomUUID(), role: 'driver' })).submission).toBeNull();
  const next = (
    await submissions.submit(driver, {
      vehicle: { ...vehicle, color: 'White' },
      expectedRevision: revision,
    })
  ).submission!;
  expect(next.status).toBe('pending');
  expect(next.corrections).toEqual([]);
  expect((await submissions.get(driver)).submission!.corrections).toEqual([]);
  expect(
    (await db.pool.query('SELECT corrections FROM vehicle_review_decisions WHERE revision=$1', [revision]))
      .rows[0].corrections,
  ).toEqual(corrections);
});
test('correction guidance is required for rejection and cannot be free-form or attached to approval', async () => {
  await grant();
  for (const change of [
    { ...approve(), corrections: ['vehicle_not_eligible'] },
    { revision, decision: 'rejected', reason: 'Synthetic rejection' },
    {
      revision,
      decision: 'rejected',
      reason: 'Synthetic rejection',
      corrections: ['Private arbitrary text'],
    },
    {
      revision,
      decision: 'rejected',
      reason: 'Synthetic rejection',
      corrections: ['vehicle_not_eligible', 'vehicle_not_eligible'],
    },
  ]) {
    await expect(review.decide(staff, driver.id, change, randomUUID())).rejects.toThrow();
  }
  expect((await db.pool.query('SELECT id FROM vehicle_review_decisions')).rowCount).toBe(0);
});
