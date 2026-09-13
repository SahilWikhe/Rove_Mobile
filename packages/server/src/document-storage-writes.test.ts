import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, test, expect, vi } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { users, drivers } from '@rove/database';
import { DriverDocumentService } from './driver-documents';
import { AccountClosures } from './account-closures';
import { SupportService } from './support';
import { AccountDeletions } from './account-deletions';
import { transaction } from './transactions';
import { DocumentCleanup } from './document-cleanup';
import { assertDocumentWritesSettled, trackedDocumentStore } from './document-storage-writes';
import type { Actor } from './rides';
let db: Awaited<ReturnType<typeof testDatabase>>, driver: Actor, staff: Actor, service: DriverDocumentService;
const body = new TextEncoder().encode('%PDF-1.7 synthetic document');
const sha256 = createHash('sha256').update(body).digest('hex');
const result = { version: 'synthetic-version', sha256, bytes: body.length };
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
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.close')", [
    staff.id,
  ]);
  service = new DriverDocumentService(db.pool);
});
async function reserve() {
  const id = randomUUID();
  await service.reserve(driver, {
    id,
    kind: 'driver_license',
    contentType: 'application/pdf',
    bytes: body.length,
    sha256,
  });
  return id;
}
async function closeAccount() {
  await new SupportService(db.pool).create(
    driver,
    { category: 'account', message: 'Delete synthetic account', deletionConsent: 'account-deletion-v1' },
    randomUUID(),
  );
  const request = (await new AccountDeletions(db.pool).status(driver)).request!;
  await new AccountClosures(db.pool, { erase: async () => ({ status: 'absent' }) }, 'synthetic-v1').authorize(
    staff,
    request.id,
    { policyReference: 'synthetic-v1', reviewReference: 'synthetic-review' },
    randomUUID(),
  );
}
async function barrier() {
  return transaction(db.pool, (c) => assertDocumentWritesSettled(c, driver.id));
}
async function expire() {
  await db.pool.query("UPDATE driver_documents SET expires_at=now()-interval '1 second'");
}

test('dispatch is committed before I/O and verified success settles before attaching the receipt', async () => {
  const id = await reserve();
  const put = vi.fn(async () => {
    const rows = (await db.pool.query('SELECT * FROM document_storage_writes')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].document_id).toBe(id);
    expect(rows[0].settled_at).toBeNull();
    expect(rows[0].object_version).toBeNull();
    return result;
  });
  expect((await service.upload(driver, id, body, { put })).state).toBe('quarantined');
  const row = (await db.pool.query('SELECT * FROM document_storage_writes')).rows[0];
  expect(row.settled_at).toBeInstanceOf(Date);
  expect(row.object_version).toBe(result.version);
  await service.upload(driver, id, body, { put });
  expect(put).toHaveBeenCalledTimes(1);
  await expect(barrier()).rejects.toMatchObject({ code: 'ACCOUNT_CLOSURE_REQUIRED' });
  await closeAccount();
  await expect(barrier()).rejects.toMatchObject({ code: 'DOCUMENT_WRITES_PENDING' });
  await expire();
  await expect(barrier()).resolves.toBeUndefined();
});
test('account closure does not wait for provider I/O and later evidence survives rejected attachment', async () => {
  const id = await reserve();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (started = r));
  const upload = service.upload(driver, id, body, {
    put: async () => {
      started();
      await gate;
      return result;
    },
  });
  const rejected = expect(upload).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await ready;
  try {
    await closeAccount();
    await expire();
    await expect(barrier()).rejects.toMatchObject({ code: 'DOCUMENT_WRITES_PENDING' });
  } finally {
    release();
  }
  await rejected;
  expect(
    (await db.pool.query('SELECT settled_at FROM document_storage_writes')).rows[0].settled_at,
  ).toBeInstanceOf(Date);
  expect((await db.pool.query('SELECT state FROM driver_documents')).rows[0].state).toBe('reserved');
  await expect(barrier()).resolves.toBeUndefined();
});
test.each(['timeout', 'bad-receipt'])(
  'uncertain %s remains a cleanup barrier after closure and expiry',
  async (mode) => {
    const id = await reserve();
    await expect(
      service.upload(driver, id, body, {
        put: async () => {
          if (mode === 'timeout') throw new Error('sensitive-provider-detail');
          return { ...result, version: 'null' };
        },
      }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_STORAGE_UNAVAILABLE' });
    await closeAccount();
    await expire();
    await expect(barrier()).rejects.toMatchObject({ code: 'DOCUMENT_WRITES_PENDING' });
    expect(
      (await db.pool.query('SELECT settled_at FROM document_storage_writes')).rows[0].settled_at,
    ).toBeNull();
  },
);
test('a disabled account cannot dispatch through a previously constructed store', async () => {
  const id = await reserve(),
    put = vi.fn(async () => result);
  const store = trackedDocumentStore(db.pool, driver, id, { put });
  await closeAccount();
  await expect(
    store.put({
      key: `driver-documents/quarantine/${id}/${randomUUID()}`,
      body,
      contentType: 'application/pdf',
      sha256,
      ifAbsent: true,
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(put).not.toHaveBeenCalled();
  expect((await db.pool.query('SELECT * FROM document_storage_writes')).rowCount).toBe(0);
});
test('write evidence cannot be erased, retargeted or changed after settlement', async () => {
  const id = await reserve();
  await service.upload(driver, id, body, { put: async () => result });
  for (const sql of [
    'DELETE FROM document_storage_writes',
    "UPDATE document_storage_writes SET object_key='other'",
    "UPDATE document_storage_writes SET object_version='changed'",
    'UPDATE document_storage_writes SET settled_at=NULL,object_version=NULL',
  ]) {
    await expect(db.pool.query(sql)).rejects.toThrow();
  }
});
test('dispatch audit failure rolls back intent before any storage write', async () => {
  const id = await reserve(),
    put = vi.fn(async () => result);
  await db.pool.query(
    "CREATE FUNCTION reject_write_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='driver.document_write_dispatched' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_write_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_write_audit()",
  );
  try {
    await expect(service.upload(driver, id, body, { put })).rejects.toMatchObject({
      code: 'DOCUMENT_STORAGE_UNAVAILABLE',
    });
    expect(put).not.toHaveBeenCalled();
    expect((await db.pool.query('SELECT * FROM document_storage_writes')).rowCount).toBe(0);
  } finally {
    await db.pool.query('DROP TRIGGER reject_write_audit ON audit; DROP FUNCTION reject_write_audit()');
  }
});

test('settlement audit failure preserves an uncertain attempt after storage succeeds', async () => {
  const id = await reserve(),
    put = vi.fn(async () => result);
  await db.pool.query(
    "CREATE FUNCTION reject_settlement_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='driver.document_write_settled' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_settlement_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_settlement_audit()",
  );
  try {
    await expect(service.upload(driver, id, body, { put })).rejects.toMatchObject({
      code: 'DOCUMENT_STORAGE_UNAVAILABLE',
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(
      (await db.pool.query('SELECT settled_at,object_version FROM document_storage_writes')).rows[0],
    ).toEqual({ settled_at: null, object_version: null });
  } finally {
    await db.pool.query(
      'DROP TRIGGER reject_settlement_audit ON audit; DROP FUNCTION reject_settlement_audit()',
    );
  }
  await closeAccount();
  await expire();
  await expect(barrier()).rejects.toMatchObject({ code: 'DOCUMENT_WRITES_PENDING' });
});
test('database rejects new writes with another document path, fabricated completion or closed owner', async () => {
  const id = await reserve();
  await expect(
    db.pool.query('INSERT INTO document_storage_writes(object_key,document_id) VALUES($1,$2)', [
      `driver-documents/quarantine/${randomUUID()}/${randomUUID()}`,
      id,
    ]),
  ).rejects.toThrow();
  await expect(
    db.pool.query(
      "INSERT INTO document_storage_writes(object_key,document_id,settled_at,object_version) VALUES($1,$2,now(),'fabricated')",
      [`driver-documents/quarantine/${id}/${randomUUID()}`, id],
    ),
  ).rejects.toThrow();
  await closeAccount();
  await expect(
    db.pool.query('INSERT INTO document_storage_writes(object_key,document_id) VALUES($1,$2)', [
      `driver-documents/quarantine/${id}/${randomUUID()}`,
      id,
    ]),
  ).rejects.toThrow();
});

test('inspection exposes unresolved uploads without settling them and paginates within the document', async () => {
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.read')", [
    staff.id,
  ]);
  const id = await reserve(),
    other = await reserve();
  for (let n = 0; n < 102; n++)
    await db.pool.query('INSERT INTO document_storage_writes(object_key,document_id) VALUES($1,$2)', [
      `driver-documents/quarantine/${id}/${randomUUID()}`,
      id,
    ]);
  await db.pool.query('INSERT INTO document_storage_writes(object_key,document_id) VALUES($1,$2)', [
    `driver-documents/quarantine/${other}/${randomUUID()}`,
    other,
  ]);
  const cleanup = new DocumentCleanup(db.pool, { discover: vi.fn(), erase: vi.fn() }, 'synthetic-policy');
  const active = await cleanup.inspectUploads(staff, id);
  expect(active.accessClosed).toBe(false);
  expect(active.reservationActive).toBe(true);
  expect(active.pendingWrites).toHaveLength(100);
  expect(active.nextCursor).not.toBeNull();
  const next = await cleanup.inspectUploads(staff, id, active.nextCursor!);
  expect(next.pendingWrites).toHaveLength(2);
  expect(next.nextCursor).toBeNull();
  expect(new Set([...active.pendingWrites, ...next.pendingWrites].map((w) => w.key)).size).toBe(102);
  expect([...active.pendingWrites, ...next.pendingWrites].every((w) => w.key.includes(id))).toBe(true);
  await expect(cleanup.inspectUploads(driver, id)).rejects.toMatchObject({ status: 403 });
  await expect(cleanup.inspectUploads(staff, other, active.nextCursor!)).rejects.toMatchObject({
    code: 'INVALID_DOCUMENT',
  });
  await closeAccount();
  await expire();
  expect(await cleanup.inspectUploads(staff, id)).toMatchObject({
    accessClosed: true,
    reservationActive: false,
  });
  await expect(barrier()).rejects.toMatchObject({ code: 'DOCUMENT_WRITES_PENDING' });
  expect(
    (await db.pool.query('SELECT * FROM document_storage_writes WHERE settled_at IS NOT NULL')).rowCount,
  ).toBe(0);
});
