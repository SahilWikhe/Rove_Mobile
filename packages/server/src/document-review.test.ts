import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { users, drivers, staffPermissions } from '@rove/database';
import { DocumentReviewService } from './document-review';
import { DriverDocumentService } from './driver-documents';
import { DocumentScanWorker } from './document-scanning';

let db: Awaited<ReturnType<typeof testDatabase>>;
let review: DocumentReviewService;
let documents: DriverDocumentService;
let driver: { id: string; role: 'driver' };
let staff: { id: string; role: 'staff'; mfa: boolean };
let id: string;
const approve = () => ({ decision: 'approved', expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
beforeAll(async () => {
  db = await testDatabase();
  review = new DocumentReviewService(db.pool);
  documents = new DriverDocumentService(db.pool);
}, 60_000);
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
  await db.db.insert(drivers).values({ id: driver.id });
  await db.db.insert(staffPermissions).values({ staffId: staff.id, permission: 'driver.document.review' });
  id = await upload();
});
async function upload() {
  const documentId = randomUUID();
  const metadata = {
    id: documentId,
    kind: 'driver_license',
    contentType: 'application/pdf',
    bytes: 40,
    sha256: 'a'.repeat(64),
  };
  await documents.reserve(driver, metadata);
  await documents.recordQuarantine(driver, {
    kind: metadata.kind,
    contentType: metadata.contentType,
    bytes: metadata.bytes,
    sha256: metadata.sha256,
    documentId,
    driverId: driver.id,
    state: 'quarantined',
    key: `driver-documents/quarantine/${documentId}/${randomUUID()}`,
    version: 'synthetic-version',
  });
  return documentId;
}
async function scan(verdict: 'clean' | 'infected' = 'clean') {
  await db.pool.query("UPDATE driver_document_scans SET available_at=now()-interval '1 second'");
  expect(
    await new DocumentScanWorker(db.pool, { scan: async (target) => ({ ...target, verdict }) }).runOnce(),
  ).toBe(verdict);
}

test('requires active staff, specific permission and MFA, including idempotent replay', async () => {
  await scan();
  const input = approve(),
    key = randomUUID();
  for (const actor of [driver, { ...staff, mfa: false }]) {
    await expect(review.list(actor, driver.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(review.decide(actor, id, input, key)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }
  await review.decide(staff, id, input, key);
  await db.pool.query('DELETE FROM staff_permissions WHERE staff_id=$1', [staff.id]);
  await expect(review.decide(staff, id, input, key)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await db.db.insert(staffPermissions).values({ staffId: staff.id, permission: 'driver.document.review' });
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [staff.id]);
  await expect(review.list(staff, driver.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('approval is idempotent, private metadata stays private, and driving stays disabled', async () => {
  await scan();
  expect((await review.list(staff, driver.id)).documents[0]?.readyForReview).toBe(true);
  const input = approve(),
    key = randomUUID();
  const results = await Promise.all([
    review.decide(staff, id, input, key),
    review.decide(staff, id, input, key),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({ status: 'approved', expiresAt: input.expiresAt, reason: null });
  expect((await review.list(staff, driver.id)).documents[0]?.readyForReview).toBe(false);
  const visible = (await documents.list(driver)).documents[0]!;
  expect(visible.review).toMatchObject({ status: 'approved', expiresAt: input.expiresAt });
  expect(Object.keys(visible.review!).sort()).toEqual(['expiresAt', 'reason', 'reviewedAt', 'status']);
  expect(JSON.stringify(visible)).not.toContain('synthetic-version');
  expect(
    (
      await db.pool.query('SELECT approved,payout_ready,eligibility_expires_at FROM drivers WHERE id=$1', [
        driver.id,
      ])
    ).rows[0],
  ).toEqual({ approved: false, payout_ready: false, eligibility_expires_at: null });
  expect((await db.pool.query("SELECT 1 FROM audit WHERE action='staff.document_reviewed'")).rowCount).toBe(
    1,
  );
  expect((await documents.list({ id: randomUUID(), role: 'driver' })).documents).toEqual([]);
});

test('pending and infected files cannot be reviewed', async () => {
  await expect(review.decide(staff, id, approve(), randomUUID())).rejects.toMatchObject({
    code: 'DOCUMENT_NOT_REVIEWABLE',
  });
  await scan('infected');
  await expect(
    review.decide(staff, id, { decision: 'rejected', reason: 'unreadable' }, randomUUID()),
  ).rejects.toMatchObject({ code: 'DOCUMENT_NOT_REVIEWABLE' });
});

test.each(['object_key', 'object_version', 'expected_sha256'])(
  'clean evidence must match current %s',
  async (column) => {
    await scan();
    await db.pool.query(`UPDATE driver_documents SET ${column}=$1 WHERE id=$2`, [
      column === 'expected_sha256' ? 'b'.repeat(64) : 'changed',
      id,
    ]);
    await expect(review.decide(staff, id, approve(), randomUUID())).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_REVIEWABLE',
    });
    expect((await review.list(staff, driver.id)).documents[0]?.readyForReview).toBe(false);
  },
);

test('new quarantined replacement supersedes the old file, but a reservation alone does not', async () => {
  await scan();
  await documents.reserve(driver, {
    id: randomUUID(),
    kind: 'driver_license',
    contentType: 'application/pdf',
    bytes: 40,
    sha256: 'a'.repeat(64),
  });
  expect((await review.list(staff, driver.id)).documents.find((d) => d.id === id)?.readyForReview).toBe(true);
  await upload();
  await expect(review.decide(staff, id, approve(), randomUUID())).rejects.toMatchObject({
    code: 'DOCUMENT_REPLACED',
  });
  expect((await review.list(staff, driver.id)).documents.find((d) => d.id === id)?.readyForReview).toBe(
    false,
  );
});

test('competing decisions commit exactly once and rejection gives safe correction guidance', async () => {
  await scan();
  const result = await Promise.allSettled([
    review.decide(staff, id, { decision: 'rejected', reason: 'unreadable' }, randomUUID()),
    review.decide(staff, id, { decision: 'rejected', reason: 'wrong_document' }, randomUUID()),
  ]);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(result.find((r) => r.status === 'rejected')).toMatchObject({
    reason: { code: 'DOCUMENT_ALREADY_REVIEWED' },
  });
  const visible = (await documents.list(driver)).documents[0]!.review!;
  expect(visible.status).toBe('rejected');
  expect(['unreadable', 'wrong_document']).toContain(visible.reason);
  expect(visible.expiresAt).toBeNull();
  expect((await db.pool.query('SELECT 1 FROM driver_document_reviews')).rowCount).toBe(1);
});

test('expired approval is refused and later expiry is reflected in driver status', async () => {
  await scan();
  await expect(
    review.decide(staff, id, { decision: 'approved', expiresAt: new Date(0).toISOString() }, randomUUID()),
  ).rejects.toMatchObject({ code: 'DOCUMENT_EXPIRED' });
  await review.decide(staff, id, approve(), randomUUID());
  await db.pool.query(
    "UPDATE driver_document_reviews SET reviewed_at=now()-interval '2 days',expires_at=now()-interval '1 day'",
  );
  expect((await documents.list(driver)).documents[0]?.review?.status).toBe('expired');
  await db.pool.query("UPDATE driver_documents SET object_version='changed' WHERE id=$1", [id]);
  expect((await documents.list(driver)).documents[0]?.review).toBeUndefined();
});

test('invalid decisions and disabled owners cannot acquire a review', async () => {
  await scan();
  for (const input of [
    { decision: 'approved' },
    { decision: 'rejected', reason: 'arbitrary private text' },
    { decision: 'rejected', reason: 'expired', expiresAt: approve().expiresAt },
  ]) {
    await expect(review.decide(staff, id, input, randomUUID())).rejects.toThrow();
  }
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [driver.id]);
  await expect(review.decide(staff, id, approve(), randomUUID())).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect((await db.pool.query('SELECT 1 FROM driver_document_reviews')).rowCount).toBe(0);
});
