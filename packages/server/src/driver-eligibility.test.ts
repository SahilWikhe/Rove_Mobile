import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { users, drivers, staffPermissions } from '@rove/database';
import { DriverEligibilityService } from './driver-eligibility';
import { VehicleSubmissionService } from './vehicle-submissions';
import { VehicleReviewService } from './vehicle-review';
import { DriverDocumentService } from './driver-documents';
import { DocumentReviewService } from './document-review';
import { DocumentScanWorker } from './document-scanning';
import { DriverService } from './drivers';
let db: Awaited<ReturnType<typeof testDatabase>>;
let service: DriverEligibilityService;
let staff: { id: string; role: 'staff'; mfa: boolean };
let driver: { id: string; role: 'driver' };
let vehicleRevision: string, documentIds: string[], documentExpiry: string;
beforeAll(async () => {
  db = await testDatabase();
  service = new DriverEligibilityService(db.pool);
}, 60_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  driver = { id: randomUUID(), role: 'driver' };
  await db.db
    .insert(users)
    .values([staff, driver].map((actor) => ({ ...actor, subject: actor.id, name: 'Synthetic' })));
  await db.db.insert(drivers).values({ id: driver.id });
  await db.db.insert(staffPermissions).values(
    ['driver.eligibility.review', 'driver.vehicle.review', 'driver.document.review'].map((permission) => ({
      staffId: staff.id,
      permission,
    })),
  );
  vehicleRevision = (
    await new VehicleSubmissionService(db.pool).submit(driver, {
      expectedRevision: null,
      vehicle: {
        make: 'Synthetic',
        model: 'Test',
        year: 2025,
        color: 'Black',
        plate: 'DEMO',
        registrationRegion: 'NC',
        requestedService: 'standard',
      },
    })
  ).submission!.revision;
  await new VehicleReviewService(db.pool).decide(
    staff,
    driver.id,
    {
      revision: vehicleRevision,
      decision: 'approved',
      verifiedService: 'standard',
      reason: 'Synthetic verified vehicle',
    },
    randomUUID(),
  );
  documentIds = [];
  documentExpiry = new Date(Date.now() + 86_400_000).toISOString();
  for (const kind of ['driver_license', 'vehicle_registration', 'vehicle_insurance']) {
    const id = await upload(kind);
    documentIds.push(id);
    await db.pool.query("UPDATE driver_document_scans SET available_at=now()-interval '1 second'");
    await new DocumentScanWorker(db.pool, {
      scan: async (target) => ({ ...target, verdict: 'clean' }),
    }).runOnce();
    await new DocumentReviewService(db.pool).decide(
      staff,
      id,
      { decision: 'approved', expiresAt: documentExpiry },
      randomUUID(),
    );
  }
});
async function upload(kind: string) {
  const id = randomUUID(),
    metadata = { kind, contentType: 'application/pdf', bytes: 40, sha256: 'a'.repeat(64) };
  const docs = new DriverDocumentService(db.pool);
  await docs.reserve(driver, { ...metadata, id });
  await docs.recordQuarantine(driver, {
    ...metadata,
    documentId: id,
    driverId: driver.id,
    state: 'quarantined',
    key: `driver-documents/quarantine/${id}/${randomUUID()}`,
    version: 'synthetic-version',
  });
  return id;
}
const approval = () => ({
  decision: 'approved',
  vehicleRevision,
  documentIds,
  clearanceReference: 'synthetic-clearance-001',
  clearanceExpiresAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  operatingRequirementsConfirmed: true,
});
test('approval is audited and capped by evidence expiry, but cannot grant payout readiness', async () => {
  const input = approval(),
    key = randomUUID();
  const results = await Promise.all([
    service.decide(staff, driver.id, input, key),
    service.decide(staff, driver.id, input, key),
  ]);
  expect(results[0]).toEqual({ approved: true, expiresAt: documentExpiry });
  expect(results[1]).toEqual(results[0]);
  expect(
    (await db.pool.query("SELECT 1 FROM audit WHERE action='staff.driver_eligibility_approved'")).rowCount,
  ).toBe(1);
  const driversService = new DriverService(db.pool);
  expect(await driversService.profile(driver)).toMatchObject({
    approved: true,
    payoutReady: false,
    eligible: false,
  });
  await expect(
    driversService.availability(driver, true, { latitude: 35.8, longitude: -78.6 }, randomUUID()),
  ).rejects.toMatchObject({ code: 'DRIVER_INELIGIBLE' });
  await db.pool.query(
    "UPDATE drivers SET payout_ready=true,payout_valid_until=now()+interval '1 hour' WHERE id=$1",
    [driver.id],
  );
  await driversService.availability(driver, true, { latitude: 35.8, longitude: -78.6 }, randomUUID());
  expect(await driversService.profile(driver)).toMatchObject({ eligible: true, online: true });
});
test('MFA and dedicated permission are required, including replay after revocation', async () => {
  const input = approval(),
    key = randomUUID();
  for (const actor of [driver, { ...staff, mfa: false }])
    await expect(service.decide(actor, driver.id, input, key)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await service.decide(staff, driver.id, input, key);
  await db.pool.query("DELETE FROM staff_permissions WHERE permission='driver.eligibility.review'");
  await expect(service.decide(staff, driver.id, input, key)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
test('stale vehicle, missing documents, duplicate ids and expired clearance cannot approve', async () => {
  await expect(
    service.decide(staff, driver.id, { ...approval(), vehicleRevision: randomUUID() }, randomUUID()),
  ).rejects.toMatchObject({ code: 'REVIEW_CHANGED' });
  await expect(
    service.decide(
      staff,
      driver.id,
      { ...approval(), documentIds: [documentIds[0], documentIds[0], documentIds[0]] },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'DOCUMENTS_REQUIRED' });
  await expect(
    service.decide(
      staff,
      driver.id,
      { ...approval(), clearanceExpiresAt: new Date(0).toISOString() },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'CLEARANCE_EXPIRED' });
  await db.pool.query("UPDATE driver_documents SET object_version='changed' WHERE id=$1", [documentIds[0]]);
  await expect(service.decide(staff, driver.id, approval(), randomUUID())).rejects.toMatchObject({
    code: 'DOCUMENTS_REQUIRED',
  });
});
test('replacement upload invalidates approval and requires a fresh review', async () => {
  await service.decide(staff, driver.id, approval(), randomUUID());
  await upload('driver_license');
  expect(
    (await db.pool.query('SELECT approved,eligibility_expires_at FROM drivers WHERE id=$1', [driver.id]))
      .rows[0],
  ).toEqual({ approved: false, eligibility_expires_at: null });
  await expect(service.decide(staff, driver.id, approval(), randomUUID())).rejects.toMatchObject({
    code: 'DOCUMENTS_REQUIRED',
  });
});
test('revocation preserves active availability state but immediately disables eligibility', async () => {
  await service.decide(staff, driver.id, approval(), randomUUID());
  await db.pool.query(
    "UPDATE drivers SET online=true,payout_ready=true,payout_valid_until=now()+interval '1 hour' WHERE id=$1",
    [driver.id],
  );
  await expect(service.decide(staff, driver.id, approval(), randomUUID())).rejects.toMatchObject({
    code: 'DRIVER_ONLINE',
  });
  await service.decide(staff, driver.id, { decision: 'revoked', reason: 'safety_review' }, randomUUID());
  expect(await new DriverService(db.pool).profile(driver)).toMatchObject({
    approved: false,
    eligible: false,
    online: true,
  });
});

test('a racing replacement cannot leave approval active on superseded evidence', async () => {
  const result = await Promise.allSettled([
    service.decide(staff, driver.id, approval(), randomUUID()),
    upload('driver_license'),
  ]);
  expect(result[1]?.status).toBe('fulfilled');
  if (result[0]?.status === 'rejected')
    expect(result[0].reason).toMatchObject({ code: 'DOCUMENTS_REQUIRED' });
  expect(
    (await db.pool.query('SELECT approved,eligibility_expires_at FROM drivers WHERE id=$1', [driver.id]))
      .rows[0],
  ).toEqual({ approved: false, eligibility_expires_at: null });
});

test('profile identifies the next eligibility step using the server clock', async () => {
  const driversService = new DriverService(db.pool);
  expect((await driversService.profile(driver)).eligibilityStatus).toBe('review_required');
  await service.decide(staff, driver.id, approval(), randomUUID());
  expect((await driversService.profile(driver)).eligibilityStatus).toBe('payout_required');
  await db.pool.query(
    "UPDATE drivers SET payout_ready=true,payout_valid_until=now()+interval '1 hour' WHERE id=$1",
    [driver.id],
  );
  expect((await driversService.profile(driver)).eligibilityStatus).toBe('eligible');
  const future = new DriverService(db.pool, () => new Date(Date.parse(documentExpiry) + 1));
  expect(await future.profile(driver)).toMatchObject({ eligibilityStatus: 'expired', eligible: false });
});
