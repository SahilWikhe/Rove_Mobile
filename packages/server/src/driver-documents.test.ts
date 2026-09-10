import { createHash, randomUUID } from 'node:crypto';
import { quarantineDriverDocument } from './document-intake';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { users, drivers } from '@rove/database';
import { DriverDocumentService } from './driver-documents';
let db: Awaited<ReturnType<typeof testDatabase>>;
let service: DriverDocumentService;
let actor: { id: string; role: 'driver' };
const input = () => ({
  id: randomUUID(),
  kind: 'driver_license',
  contentType: 'application/pdf',
  sha256: 'a'.repeat(64),
  bytes: 100,
});
beforeAll(async () => {
  db = await testDatabase();
  service = new DriverDocumentService(db.pool);
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  actor = { id: randomUUID(), role: 'driver' };
  await db.db.insert(users).values({ ...actor, subject: actor.id, name: 'Synthetic driver' });
  await db.db.insert(drivers).values({ id: actor.id, vehicle: {}, service: 'standard' });
});
test('reserves once across concurrent retries and exposes only safe metadata', async () => {
  const body = input();
  const results = await Promise.all([service.reserve(actor, body), service.reserve(actor, body)]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0].state).toBe('reserved');
  expect((await db.pool.query('SELECT * FROM driver_documents')).rowCount).toBe(1);
  expect((await db.pool.query("SELECT * FROM audit WHERE action='driver.document_reserved'")).rowCount).toBe(
    1,
  );
  expect(Object.keys(results[0]).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'kind', 'state']);
  expect((await service.list(actor)).documents).toEqual([results[0]]);
});
test('rejects reused identifiers with changed content', async () => {
  const body = input();
  await service.reserve(actor, body);
  await expect(service.reserve(actor, { ...body, bytes: 101 })).rejects.toMatchObject({
    code: 'DOCUMENT_CONFLICT',
  });
});
test('does not grant another driver access to a reservation', async () => {
  const body = input();
  await service.reserve(actor, body);
  const other = { id: randomUUID(), role: 'driver' as const };
  await db.db.insert(users).values({ ...other, subject: other.id, name: 'Other synthetic driver' });
  await db.db.insert(drivers).values({ id: other.id, vehicle: {}, service: 'standard' });
  expect((await service.list(other)).documents).toEqual([]);
  await expect(service.reserve(other, body)).rejects.toMatchObject({ code: 'DOCUMENT_CONFLICT' });
});
test('disabled accounts and rider roles cannot reserve', async () => {
  await expect(service.reserve({ ...actor, role: 'rider' }, input())).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [actor.id]);
  await expect(service.reserve(actor, input())).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
test('reservation quota remains bounded under concurrent requests', async () => {
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => service.reserve(actor, input())));
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(10);
  expect((await db.pool.query('SELECT * FROM driver_documents')).rowCount).toBe(10);
});
test('expired retries do not renew upload lifetime or imply document approval', async () => {
  const body = input();
  await service.reserve(actor, body);
  await db.pool.query("UPDATE driver_documents SET expires_at=now()-interval '1 second' WHERE id=$1", [
    body.id,
  ]);
  expect((await service.reserve(actor, body)).state).toBe('expired');
  expect((await service.list(actor)).documents[0]?.state).toBe('expired');
  expect((await db.pool.query('SELECT approved FROM drivers WHERE id=$1', [actor.id])).rows[0].approved).toBe(
    false,
  );
});
test('database rejects impossible quarantine metadata and unsafe sizes', async () => {
  const body = input();
  await service.reserve(actor, body);
  await expect(
    db.pool.query("UPDATE driver_documents SET state='quarantined' WHERE id=$1", [body.id]),
  ).rejects.toThrow();
  await expect(
    db.pool.query('UPDATE driver_documents SET expected_bytes=0 WHERE id=$1', [body.id]),
  ).rejects.toThrow();
});

async function uploaded() {
  const bytes = new TextEncoder().encode('%PDF-1.7 synthetic document');
  const reservation = {
    ...input(),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await service.reserve(actor, reservation);
  const receipt = await quarantineDriverDocument(
    {
      documentId: reservation.id,
      driverId: actor.id,
      kind: reservation.kind,
      contentType: reservation.contentType,
      expectedSha256: reservation.sha256,
    },
    bytes,
    {
      put: async (value) => ({
        version: 'immutable-fixture',
        sha256: value.sha256,
        bytes: value.body.length,
      }),
    },
  );
  return { receipt, reservation };
}
test('validated upload completion is durable and idempotent without approving the driver', async () => {
  const { receipt } = await uploaded();
  const results = await Promise.all([
    service.recordQuarantine(actor, receipt),
    service.recordQuarantine(actor, receipt),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0].state).toBe('quarantined');
  expect(results[0]).not.toHaveProperty('key');
  expect((await service.list(actor)).documents[0]?.state).toBe('quarantined');
  expect(
    (await db.pool.query("SELECT * FROM audit WHERE action='driver.document_quarantined'")).rowCount,
  ).toBe(1);
  expect((await db.pool.query('SELECT approved FROM drivers WHERE id=$1', [actor.id])).rows[0].approved).toBe(
    false,
  );
});
test('late storage completion cannot revive an expired reservation', async () => {
  const { receipt } = await uploaded();
  await db.pool.query("UPDATE driver_documents SET expires_at=now()-interval '1 second' WHERE id=$1", [
    receipt.documentId,
  ]);
  await expect(service.recordQuarantine(actor, receipt)).rejects.toMatchObject({ code: 'DOCUMENT_EXPIRED' });
  expect((await service.list(actor)).documents[0]?.state).toBe('expired');
});
test('recorded receipt remains retryable after reservation expiry but cannot be replaced', async () => {
  const { receipt } = await uploaded();
  await service.recordQuarantine(actor, receipt);
  await db.pool.query("UPDATE driver_documents SET expires_at=now()-interval '1 second' WHERE id=$1", [
    receipt.documentId,
  ]);
  expect((await service.recordQuarantine(actor, receipt)).state).toBe('quarantined');
  await expect(
    service.recordQuarantine(actor, { ...receipt, version: 'different-version' }),
  ).rejects.toMatchObject({ code: 'DOCUMENT_CONFLICT' });
});
test('storage metadata must match the reserved file and private path', async () => {
  const { receipt } = await uploaded();
  await expect(
    service.recordQuarantine(actor, { ...receipt, bytes: receipt.bytes + 1 }),
  ).rejects.toMatchObject({ code: 'DOCUMENT_CONFLICT' });
  await expect(
    service.recordQuarantine(actor, { ...receipt, key: 'public/document.pdf' }),
  ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  await expect(service.recordQuarantine(actor, { ...receipt, driverId: randomUUID() })).rejects.toMatchObject(
    { code: 'FORBIDDEN' },
  );
  expect((await service.list(actor)).documents[0]?.state).toBe('reserved');
});
test('an account disabled while the file is uploading cannot finalize it', async () => {
  const { receipt } = await uploaded();
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [actor.id]);
  await expect(service.recordQuarantine(actor, receipt)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(
    (await db.pool.query('SELECT state FROM driver_documents WHERE id=$1', [receipt.documentId])).rows[0]
      .state,
  ).toBe('reserved');
});
