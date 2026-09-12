import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, test, expect, vi } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { users, drivers } from '@rove/database';
import { DriverDocumentService } from './driver-documents';
import { AccountClosures } from './account-closures';
import { AccountDeletions } from './account-deletions';
import { SupportService } from './support';
import { DocumentCleanup, type DocumentCleanupProvider } from './document-cleanup';
import { RetentionHolds } from './retention-holds';
import { OutboxWorker } from './outbox';
import type { Actor } from './rides';
let db: Awaited<ReturnType<typeof testDatabase>>,
  driver: Actor,
  staff: Actor,
  documentId: string,
  service: DocumentCleanup;
const provider = {
  discover: vi.fn<DocumentCleanupProvider['discover']>(),
  erase: vi.fn<DocumentCleanupProvider['erase']>(),
};
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users,outbox CASCADE');
  driver = { id: randomUUID(), role: 'driver' };
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  await db.db
    .insert(users)
    .values([driver, staff].map((a) => ({ id: a.id, role: a.role, subject: a.id, name: 'Synthetic' })));
  await db.db.insert(drivers).values({ id: driver.id });
  await db.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.close'),($1,'privacy.cleanup'),($1,'privacy.read'),($1,'privacy.hold'),($1,'privacy.release-hold')",
    [staff.id],
  );
  documentId = randomUUID();
  await new DriverDocumentService(db.pool).reserve(driver, {
    id: documentId,
    kind: 'driver_license',
    contentType: 'application/pdf',
    sha256: 'a'.repeat(64),
    bytes: 100,
  });
  await new SupportService(db.pool).create(
    driver,
    { category: 'account', message: 'Delete synthetic account', deletionConsent: 'account-deletion-v1' },
    randomUUID(),
  );
  const request = (await new AccountDeletions(db.pool).status(driver)).request!;
  await new AccountClosures(
    db.pool,
    { erase: async () => ({ status: 'absent' }) },
    'synthetic-policy',
  ).authorize(
    staff,
    request.id,
    { policyReference: 'synthetic-policy', reviewReference: 'review' },
    randomUUID(),
  );
  await db.pool.query("UPDATE driver_documents SET expires_at=now()-interval '1 second'");
  await db.pool.query('TRUNCATE outbox CASCADE');
  provider.discover.mockReset().mockResolvedValue([
    {
      documentId,
      key: `driver-documents/inbox/${documentId}/${randomUUID()}`,
      version: 'inbox-version',
      kind: 'object',
    },
    {
      documentId,
      key: `driver-documents/quarantine/${documentId}/${randomUUID()}`,
      version: 'quarantine-version',
      kind: 'object',
    },
    {
      documentId,
      key: `driver-documents/inbox/${documentId}/${randomUUID()}`,
      version: 'marker-version',
      kind: 'delete_marker',
    },
  ]);
  provider.erase.mockReset().mockResolvedValue({ status: 'absent' });
  service = new DocumentCleanup(db.pool, provider, 'synthetic-policy');
});
async function plan() {
  return service.prepare(staff, documentId, randomUUID());
}
function approval(hash: string) {
  return {
    manifestHash: hash,
    policyReference: 'synthetic-policy',
    reviewReference: 'synthetic-review',
    quiescenceReference: 'synthetic-drain-review',
    notBefore: new Date(Date.now() - 1000).toISOString(),
  };
}
async function item() {
  return (await db.pool.query('SELECT id FROM document_cleanup_items ORDER BY id LIMIT 1')).rows[0]
    .id as string;
}
async function hold() {
  return new RetentionHolds(db.pool).place(
    staff,
    driver.id,
    { kind: 'privacy', reasonReference: 'synthetic-case', reviewAt: new Date().toISOString() },
    randomUUID(),
  );
}

test('prepares without deleting and immutable approval queues exact versions; markers remain separate', async () => {
  const p = await plan();
  expect(p.state).toBe('draft');
  expect(p.objects).toBe(2);
  expect(p.deleteMarkers).toBe(1);
  expect(provider.erase).not.toHaveBeenCalled();
  expect((await db.pool.query('SELECT * FROM outbox')).rowCount).toBe(0);
  const input = approval(p.manifestHash),
    key = randomUUID();
  await Promise.all([service.approve(staff, p.id, input, key), service.approve(staff, p.id, input, key)]);
  const worker = new OutboxWorker(db.pool, { 'document.version-delete': service.handle });
  expect(await worker.runOnce()).toEqual({ processed: 2, failed: 0 });
  expect(provider.erase.mock.calls.map((c) => c[0].version).sort()).toEqual([
    'inbox-version',
    'quarantine-version',
  ]);
  const status = await service.inspect(staff, p.id);
  expect(status.state).toBe('versions_removed');
  expect(status.removed).toBe(2);
  expect(status.attempted).toBe(2);
  expect(status.deleteMarkers).toBe(1);
  await service.removeVersion(await item());
  expect(provider.erase).toHaveBeenCalledTimes(2);
});
test('approval requires matching manifest, policy, MFA and current cleanup permission', async () => {
  const p = await plan(),
    a = approval(p.manifestHash);
  await expect(service.approve(driver, p.id, a, randomUUID())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(service.approve({ ...staff, mfa: false }, p.id, a, randomUUID())).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(
    service.approve(staff, p.id, { ...a, manifestHash: '0'.repeat(64) }, randomUUID()),
  ).rejects.toMatchObject({ code: 'CLEANUP_MANIFEST_CHANGED' });
  await expect(
    service.approve(staff, p.id, { ...a, policyReference: 'wrong' }, randomUUID()),
  ).rejects.toMatchObject({ code: 'CLEANUP_POLICY' });
  const key = randomUUID();
  await service.approve(staff, p.id, a, key);
  await db.pool.query("DELETE FROM staff_permissions WHERE permission='privacy.cleanup'");
  await expect(service.approve(staff, p.id, a, key)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
test('unapproved and not-yet-due items cannot dispatch even when invoked directly', async () => {
  const p = await plan(),
    id = await item();
  await expect(service.removeVersion(id)).rejects.toMatchObject({ code: 'CLEANUP_NOT_AUTHORIZED' });
  await service.approve(
    staff,
    p.id,
    { ...approval(p.manifestHash), notBefore: new Date(Date.now() + 60000).toISOString() },
    randomUUID(),
  );
  await expect(service.removeVersion(id)).rejects.toMatchObject({ code: 'CLEANUP_NOT_AUTHORIZED' });
  expect(provider.erase).not.toHaveBeenCalled();
});
test('holds block preparation, approval and every dispatch retry', async () => {
  const h = await hold();
  await expect(plan()).rejects.toMatchObject({ code: 'RETENTION_HOLD' });
  expect(provider.discover).not.toHaveBeenCalled();
  await new RetentionHolds(db.pool).release(staff, h.id, { releaseReference: 'release' }, randomUUID());
  const p = await plan();
  const h2 = await hold();
  await expect(service.approve(staff, p.id, approval(p.manifestHash), randomUUID())).rejects.toMatchObject({
    code: 'RETENTION_HOLD',
  });
  await new RetentionHolds(db.pool).release(staff, h2.id, { releaseReference: 'release' }, randomUUID());
  await service.approve(staff, p.id, approval(p.manifestHash), randomUUID());
  provider.erase.mockRejectedValueOnce(new Error('provider failure'));
  const id = await item();
  await expect(service.removeVersion(id)).rejects.toThrow();
  await hold();
  await expect(service.removeVersion(id)).rejects.toMatchObject({ code: 'RETENTION_HOLD' });
  expect(provider.erase).toHaveBeenCalledTimes(1);
  expect((await service.inspect(staff, p.id)).attempted).toBe(1);
});
test('a later hold does not suppress verified outcome of an earlier dispatch', async () => {
  const p = await plan();
  await service.approve(staff, p.id, approval(p.manifestHash), randomUUID());
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>((r) => (started = r)),
    gate = new Promise<void>((r) => (release = r));
  provider.erase.mockImplementationOnce(async () => {
    started();
    await gate;
    return { status: 'absent' };
  });
  const operation = service.removeVersion(await item());
  await ready;
  try {
    await hold();
  } finally {
    release();
  }
  await operation;
  expect((await service.inspect(staff, p.id)).removed).toBe(1);
});
test('inventory ownership or duplicate errors never persist a manifest', async () => {
  provider.discover.mockResolvedValueOnce([
    { documentId: randomUUID(), key: 'wrong', version: 'v', kind: 'object' },
  ]);
  await expect(plan()).rejects.toMatchObject({ code: 'DOCUMENT_INVENTORY_UNAVAILABLE' });
  expect((await db.pool.query('SELECT * FROM document_cleanup_plans')).rowCount).toBe(0);
});
test('approval, item scope and dispatch/removal evidence cannot be rewritten', async () => {
  const p = await plan();
  const a = approval(p.manifestHash);
  await service.approve(staff, p.id, a, randomUUID());
  await expect(
    service.approve(staff, p.id, { ...a, reviewReference: 'changed' }, randomUUID()),
  ).rejects.toMatchObject({ code: 'CLEANUP_ALREADY_APPROVED' });
  for (const sql of [
    "UPDATE document_cleanup_plans SET manifest_hash=repeat('0',64)",
    "UPDATE document_cleanup_plans SET review_reference='changed'",
    'DELETE FROM document_cleanup_plans',
    "UPDATE document_cleanup_items SET object_version='changed'",
    'DELETE FROM document_cleanup_items',
  ])
    await expect(db.pool.query(sql)).rejects.toThrow();
  await service.removeVersion(await item());
  await expect(db.pool.query('UPDATE document_cleanup_items SET attempted_at=NULL')).rejects.toThrow();
  await expect(db.pool.query('UPDATE document_cleanup_items SET removed_at=NULL')).rejects.toThrow();
});
test('audited recovery requeues only exhausted work and preserves approval and active leases', async () => {
  const p = await plan();
  await service.approve(staff, p.id, approval(p.manifestHash), randomUUID());
  await db.pool.query('UPDATE outbox SET dead_letter_at=now(),attempts=12');
  const id = await item();
  await db.pool.query(
    "UPDATE outbox SET locked_until=now()+interval '1 minute',lease_token=$2 WHERE aggregate_id=$1",
    [id, randomUUID()],
  );
  expect(await service.retry(staff, p.id, randomUUID())).toEqual({ requeued: 1 });
  expect((await db.pool.query('SELECT * FROM outbox WHERE dead_letter_at IS NOT NULL')).rowCount).toBe(1);
});
test('approval audit failure rolls back approval and all version jobs', async () => {
  const p = await plan();
  await db.pool.query(
    "CREATE FUNCTION reject_cleanup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document.cleanup_approved' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_cleanup_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_cleanup_audit()",
  );
  try {
    await expect(service.approve(staff, p.id, approval(p.manifestHash), randomUUID())).rejects.toThrow();
    expect((await db.pool.query('SELECT * FROM outbox')).rowCount).toBe(0);
    expect((await service.inspect(staff, p.id)).state).toBe('draft');
  } finally {
    await db.pool.query('DROP TRIGGER reject_cleanup_audit ON audit; DROP FUNCTION reject_cleanup_audit()');
  }
});

test('a hold placed during discovery prevents the manifest from being committed', async () => {
  const inventory = await provider.discover(documentId);
  provider.discover.mockImplementationOnce(async () => {
    await hold();
    return inventory;
  });
  await expect(plan()).rejects.toMatchObject({ code: 'RETENTION_HOLD' });
  expect((await db.pool.query('SELECT * FROM document_cleanup_plans')).rowCount).toBe(0);
});
test('manifest cannot gain new targets after preparation and confirmed retries perform no deletion during a hold', async () => {
  const p = await plan();
  await expect(
    db.pool.query('INSERT INTO document_cleanup_items(plan_id,object_key,object_version) VALUES($1,$2,$3)', [
      p.id,
      `driver-documents/inbox/${documentId}/${randomUUID()}`,
      'late-version',
    ]),
  ).rejects.toThrow();
  await service.approve(staff, p.id, approval(p.manifestHash), randomUUID());
  const id = await item();
  await service.removeVersion(id);
  await hold();
  await expect(service.removeVersion(id)).resolves.toBeUndefined();
  expect(provider.erase).toHaveBeenCalledTimes(1);
});
test('failed result audit leaves attempted evidence and recovers from provider-confirmed absence', async () => {
  const p = await plan();
  await service.approve(staff, p.id, approval(p.manifestHash), randomUUID());
  const id = await item();
  await db.pool.query(
    "CREATE FUNCTION reject_removed_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document.version_removed' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_removed_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_removed_audit()",
  );
  try {
    await expect(service.removeVersion(id)).rejects.toThrow();
    const state = await service.inspect(staff, p.id);
    expect(state.attempted).toBe(1);
    expect(state.removed).toBe(0);
  } finally {
    await db.pool.query('DROP TRIGGER reject_removed_audit ON audit; DROP FUNCTION reject_removed_audit()');
  }
  await service.removeVersion(id);
  expect((await service.inspect(staff, p.id)).removed).toBe(1);
});
