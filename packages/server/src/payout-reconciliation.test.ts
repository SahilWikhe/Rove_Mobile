import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { PayoutReconciler } from './payout-reconciliation';
import { DriverService } from './drivers';
import { OutboxWorker } from './outbox';
import type { DriverPayoutProvider } from './driver-payout-provider';
let db: Awaited<ReturnType<typeof testDatabase>>,
  now: Date,
  driverId: string,
  bindingId: string,
  service: PayoutReconciler;
const status = vi.fn<DriverPayoutProvider['status']>();
const provider: DriverPayoutProvider = {
  status,
  createAccount: async () => {
    throw new Error('No provisioning');
  },
  onboardingLink: async () => {
    throw new Error('No links');
  },
};
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  await db.pool.query('TRUNCATE outbox,audit');
  now = new Date('2026-09-08T12:00:00Z');
  driverId = randomUUID();
  bindingId = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Synthetic','driver')",
    [driverId],
  );
  await db.pool.query(
    'INSERT INTO drivers(id,approved,online,eligibility_expires_at) VALUES($1,true,true,$2)',
    [driverId, new Date(now.getTime() + 86400000)],
  );
  await db.pool.query(
    "INSERT INTO driver_payout_accounts(id,driver_id,source,account_id) VALUES($1,$2,'acct_platform:test','acct_driver')",
    [bindingId, driverId],
  );
  status.mockReset().mockResolvedValue('ready');
  service = new PayoutReconciler(db.pool, provider, 'acct_platform:test', () => now);
});
const row = async () =>
  (
    await db.pool.query('SELECT approved,online,payout_ready,payout_valid_until FROM drivers WHERE id=$1', [
      driverId,
    ])
  ).rows[0];
test('verified capabilities give bounded payout eligibility without granting document approval', async () => {
  await db.pool.query('UPDATE drivers SET approved=false WHERE id=$1', [driverId]);
  await service.reconcile('acct_driver');
  expect(await row()).toMatchObject({
    approved: false,
    online: true,
    payout_ready: true,
    payout_valid_until: new Date(now.getTime() + 3600000),
  });
  const drivers = new DriverService(db.pool, () => now);
  const actor = { id: driverId, role: 'driver' as const };
  expect((await drivers.profile(actor)).eligible).toBe(false);
  await db.pool.query('UPDATE drivers SET approved=true WHERE id=$1', [driverId]);
  expect((await drivers.profile(actor)).eligible).toBe(true);
  now = new Date(now.getTime() + 3600000);
  expect((await drivers.profile(actor)).payoutReady).toBe(false);
  await expect(
    drivers.availability(actor, true, { latitude: 35.78, longitude: -78.64 }, randomUUID()),
  ).rejects.toMatchObject({ code: 'DRIVER_INELIGIBLE' });
});
test('restriction or provider failure revokes eligibility while leaving trip availability untouched', async () => {
  await service.reconcile('acct_driver');
  status.mockResolvedValueOnce('needs_information');
  await service.reconcile('acct_driver');
  expect(await row()).toMatchObject({
    approved: true,
    online: true,
    payout_ready: false,
    payout_valid_until: null,
  });
  await service.reconcile('acct_driver');
  status.mockRejectedValueOnce(new Error('Private provider data'));
  await expect(service.reconcile('acct_driver')).rejects.toMatchObject({
    code: 'PAYOUT_PROVIDER_UNAVAILABLE',
  });
  expect(await row()).toMatchObject({ payout_ready: false, payout_valid_until: null });
  expect((await db.pool.query('SELECT status FROM driver_payout_accounts')).rows[0].status).toBe(
    'unavailable',
  );
  expect(JSON.stringify((await db.pool.query('SELECT metadata FROM audit')).rows)).not.toContain(
    'Private provider',
  );
});
test('an older successful response cannot overwrite a newer restriction', async () => {
  let resolveOld!: (value: 'ready') => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  status.mockImplementationOnce(() => {
    started();
    return new Promise((resolve) => {
      resolveOld = resolve;
    });
  });
  const older = service.reconcile('acct_driver');
  await waiting;
  status.mockResolvedValueOnce('needs_information');
  await service.reconcile('acct_driver');
  resolveOld('ready');
  await older;
  expect((await row()).payout_ready).toBe(false);
  expect((await db.pool.query('SELECT status,sync_revision FROM driver_payout_accounts')).rows[0]).toEqual({
    status: 'needs_information',
    sync_revision: 2,
  });
});
test('recovery sweeps deduplicate in parallel and worker refreshes eligible accounts', async () => {
  expect((await Promise.all([service.sweep(), service.sweep()])).reduce((a, b) => a + b)).toBe(1);
  const worker = new OutboxWorker(db.pool, { 'payout.reconcile': service.handle }, () => now);
  // Scheduling uses database timestamps; advance test clock to the real enqueue availability only for worker claim.
  const jobs = (await db.pool.query('SELECT * FROM outbox')).rows;
  expect(jobs).toHaveLength(1);
  await db.pool.query('UPDATE outbox SET available_at=$1', [now]);
  expect(await worker.runOnce()).toEqual({ processed: 1, failed: 0 });
  expect((await row()).payout_ready).toBe(true);
  now = new Date(now.getTime() + 1800000);
  expect(await service.sweep()).toBe(1);
  expect((await db.pool.query('SELECT * FROM outbox')).rows).toHaveLength(2);
});
test('source mismatch, unknown accounts and disabled drivers cannot grant eligibility', async () => {
  await expect(
    service.handle({
      id: randomUUID(),
      topic: 'payout.reconcile',
      aggregateId: randomUUID(),
      attempt: 1,
      payload: { source: 'acct_other:live', accountId: 'acct_driver' },
    }),
  ).rejects.toMatchObject({ code: 'PAYOUT_JOB_MISMATCH' });
  await service.reconcile('acct_unknown');
  expect(status).not.toHaveBeenCalled();
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [driverId]);
  await service.reconcile('acct_driver');
  expect((await row()).payout_ready).toBe(false);
});
