import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { users, drivers } from '@rove/database';
import { DriverDocumentService } from './driver-documents';
import { DocumentScanWorker, hasCleanDocumentScan, type ScanTarget } from './document-scanning';

let db: Awaited<ReturnType<typeof testDatabase>>;
let documentId: string;
let driverId: string;
beforeAll(async () => {
  db = await testDatabase();
}, 60_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  driverId = randomUUID();
  documentId = randomUUID();
  const actor = { id: driverId, role: 'driver' as const };
  await db.db.insert(users).values({ ...actor, subject: driverId, name: 'Synthetic driver' });
  await db.db.insert(drivers).values({ id: driverId, vehicle: {}, service: 'standard' });
  const service = new DriverDocumentService(db.pool);
  const metadata = {
    id: documentId,
    kind: 'driver_license',
    contentType: 'application/pdf',
    sha256: 'a'.repeat(64),
    bytes: 40,
  };
  await service.reserve(actor, metadata);
  const receipt = {
    documentId,
    driverId,
    kind: metadata.kind,
    contentType: metadata.contentType,
    sha256: metadata.sha256,
    bytes: metadata.bytes,
    state: 'quarantined',
    key: `driver-documents/quarantine/${documentId}/${randomUUID()}`,
    version: 'synthetic-version',
  };
  await Promise.all([service.recordQuarantine(actor, receipt), service.recordQuarantine(actor, receipt)]);
});
const scanState = async () =>
  (await db.pool.query('SELECT * FROM driver_document_scans WHERE document_id=$1', [documentId])).rows[0];

test('completion queues exactly once and clean scan never approves the driver', async () => {
  expect((await db.pool.query('SELECT * FROM driver_document_scans')).rowCount).toBe(1);
  expect(await hasCleanDocumentScan(db.pool, documentId)).toBe(false);
  const scan = vi.fn(async (target: ScanTarget) => ({ ...target, verdict: 'clean' as const }));
  const worker = new DocumentScanWorker(db.pool, { scan });
  expect(await worker.runOnce()).toBe('clean');
  expect(await worker.runOnce()).toBe('idle');
  expect(scan).toHaveBeenCalledTimes(1);
  expect(await hasCleanDocumentScan(db.pool, documentId)).toBe(true);
  expect((await db.pool.query('SELECT approved FROM drivers WHERE id=$1', [driverId])).rows[0].approved).toBe(
    false,
  );
  expect((await db.pool.query("SELECT * FROM audit WHERE action='driver.document_scanned'")).rowCount).toBe(
    1,
  );
  await db.pool.query("UPDATE driver_documents SET object_version='replaced' WHERE id=$1", [documentId]);
  expect(await hasCleanDocumentScan(db.pool, documentId)).toBe(false);
});

test('infected documents remain inaccessible', async () => {
  const worker = new DocumentScanWorker(db.pool, {
    scan: async (target) => ({ ...target, verdict: 'infected' }),
  });
  expect(await worker.runOnce()).toBe('infected');
  expect(await hasCleanDocumentScan(db.pool, documentId)).toBe(false);
  expect(await worker.runOnce()).toBe('idle');
});

test.each(['documentId', 'key', 'version', 'sha256'] as const)(
  'rejects scanner evidence for a different %s',
  async (field) => {
    const worker = new DocumentScanWorker(db.pool, {
      scan: async (target) => ({
        ...target,
        [field]: field === 'documentId' ? randomUUID() : field === 'sha256' ? 'b'.repeat(64) : 'wrong',
        verdict: 'clean',
      }),
    });
    expect(await worker.runOnce()).toBe('retry');
    expect(await hasCleanDocumentScan(db.pool, documentId)).toBe(false);
    expect((await scanState()).completed_at).toBeNull();
  },
);

test('provider failures are delayed, sanitized and eventually held for intervention', async () => {
  const worker = new DocumentScanWorker(db.pool, {
    scan: async () => {
      throw new Error('private-provider-diagnostic');
    },
  });
  expect(await worker.runOnce()).toBe('retry');
  expect(await worker.runOnce()).toBe('idle');
  expect(JSON.stringify(await scanState())).not.toContain('private-provider');
  await db.pool.query("UPDATE driver_document_scans SET attempts=11,available_at=now()-interval '1 second'");
  expect(await worker.runOnce()).toBe('failed');
  expect(await worker.runOnce()).toBe('idle');
  expect(await hasCleanDocumentScan(db.pool, documentId)).toBe(false);
});

test('concurrent workers do not scan an active lease twice', async () => {
  let finish!: (value: ScanTarget & { verdict: 'clean' }) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let target!: ScanTarget;
  const first = new DocumentScanWorker(db.pool, {
    scan: async (value) => {
      target = value;
      entered();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const running = first.runOnce();
  await started;
  const scan = vi.fn(async (value: ScanTarget) => ({ ...value, verdict: 'infected' as const }));
  expect(await new DocumentScanWorker(db.pool, { scan }).runOnce()).toBe('idle');
  finish({ ...target, verdict: 'clean' });
  expect(await running).toBe('clean');
  expect(scan).not.toHaveBeenCalled();
});

test('an expired worker cannot overwrite the replacement worker verdict', async () => {
  let finish!: (value: ScanTarget & { verdict: 'clean' }) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let target!: ScanTarget;
  const first = new DocumentScanWorker(db.pool, {
    scan: async (value) => {
      target = value;
      entered();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const running = first.runOnce();
  await started;
  await db.pool.query("UPDATE driver_document_scans SET locked_until=now()-interval '1 second'");
  expect(
    await new DocumentScanWorker(db.pool, {
      scan: async (value) => ({ ...value, verdict: 'infected' }),
    }).runOnce(),
  ).toBe('infected');
  finish({ ...target, verdict: 'clean' });
  expect(await running).toBe('stale');
  expect((await scanState()).state).toBe('infected');
});

test('database cannot store a clean verdict without complete evidence', async () => {
  await expect(db.pool.query("UPDATE driver_document_scans SET state='clean'")).rejects.toThrow();
  await expect(
    db.pool.query('UPDATE driver_document_scans SET lease_token=$1', [randomUUID()]),
  ).rejects.toThrow();
});

test('unresponsive scanners time out and abort without accepting a late clean result', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let signal!: AbortSignal;
  try {
    const worker = new DocumentScanWorker(db.pool, {
      scan: async (_target, abort) => {
        signal = abort;
        entered();
        return new Promise(() => {});
      },
    });
    const running = worker.runOnce();
    await started;
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await running).toBe('retry');
    expect(signal.aborted).toBe(true);
    expect(await hasCleanDocumentScan(db.pool, documentId)).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test('quarantine completion rolls back if scan work cannot be persisted', async () => {
  const service = new DriverDocumentService(db.pool);
  const id = randomUUID();
  const metadata = {
    id,
    kind: 'driver_license',
    contentType: 'application/pdf',
    sha256: 'a'.repeat(64),
    bytes: 40,
  };
  await service.reserve({ id: driverId, role: 'driver' }, metadata);
  // A conflicting queue row simulates an enqueue failure after storage was verified.
  await db.pool.query('INSERT INTO driver_document_scans(document_id) VALUES($1)', [id]);
  await expect(
    service.recordQuarantine(
      { id: driverId, role: 'driver' },
      {
        documentId: id,
        driverId,
        kind: metadata.kind,
        contentType: metadata.contentType,
        sha256: metadata.sha256,
        bytes: metadata.bytes,
        state: 'quarantined',
        key: `driver-documents/quarantine/${id}/${randomUUID()}`,
        version: 'synthetic-version',
      },
    ),
  ).rejects.toThrow();
  expect((await db.pool.query('SELECT state FROM driver_documents WHERE id=$1', [id])).rows[0].state).toBe(
    'reserved',
  );
  expect(
    (
      await db.pool.query(
        "SELECT 1 FROM audit WHERE aggregate_id=$1 AND action='driver.document_quarantined'",
        [id],
      )
    ).rowCount,
  ).toBe(0);
});

test.each([
  ['clean', 'awaiting_review'],
  ['infected', 'replacement_required'],
] as const)('driver sees actionable %s status without storage metadata', async (verdict, verification) => {
  const service = new DriverDocumentService(db.pool);
  const actor = { id: driverId, role: 'driver' as const };
  expect((await service.list(actor)).documents[0]?.verification).toBe('pending');
  expect(
    await new DocumentScanWorker(db.pool, { scan: async (value) => ({ ...value, verdict }) }).runOnce(),
  ).toBe(verdict);
  const summary = (await service.list(actor)).documents[0]!;
  expect(summary.verification).toBe(verification);
  expect(Object.keys(summary).sort()).toEqual([
    'createdAt',
    'expiresAt',
    'id',
    'kind',
    'state',
    'verification',
  ]);
  const other = { id: randomUUID(), role: 'driver' as const };
  expect((await service.list(other)).documents).toEqual([]);
  // Evidence for an old object must never display as verified or rejected for the replacement.
  await db.pool.query("UPDATE driver_documents SET object_version='replaced' WHERE id=$1", [documentId]);
  expect((await service.list(actor)).documents[0]?.verification).toBe('pending');
});

test('exhausted scanning reports a support path instead of pretending verification is still running', async () => {
  await db.pool.query("UPDATE driver_document_scans SET state='failed' WHERE document_id=$1", [documentId]);
  expect(
    (await new DriverDocumentService(db.pool).list({ id: driverId, role: 'driver' })).documents[0]
      ?.verification,
  ).toBe('delayed');
});
