import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { DriverPayouts } from './driver-payouts';
import type { DriverPayoutProvider } from './driver-payout-provider';
let db: Awaited<ReturnType<typeof testDatabase>>;
let actor: { id: string; role: 'driver' }, now: Date, service: DriverPayouts;
const createAccount = vi.fn<DriverPayoutProvider['createAccount']>();
const status = vi.fn<DriverPayoutProvider['status']>();
const onboardingLink = vi.fn<DriverPayoutProvider['onboardingLink']>();
const provider = { createAccount, status, onboardingLink };
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  actor = { id: randomUUID(), role: 'driver' };
  now = new Date('2026-09-08T12:00:00Z');
  await db.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Private driver','driver')",
    [actor.id],
  );
  await db.pool.query('INSERT INTO drivers(id) VALUES($1)', [actor.id]);
  createAccount.mockReset().mockResolvedValue('acct_fixture');
  status.mockReset().mockResolvedValue('needs_information');
  onboardingLink.mockReset().mockResolvedValue({
    url: 'https://accounts.stripe.com/r/fixture',
    expiresAt: new Date(now.getTime() + 600000).toISOString(),
  });
  service = new DriverPayouts(db.pool, 'acct_platform:test', provider, () => now);
});
test('parallel setup and lost responses reuse one durable identity without granting driver eligibility', async () => {
  createAccount.mockRejectedValueOnce(new Error('Uncertain outcome'));
  await expect(service.start(actor)).rejects.toThrow();
  expect(await service.status(actor)).toEqual({ status: 'pending' });
  await Promise.all(Array.from({ length: 6 }, () => service.start(actor)));
  expect(new Set(createAccount.mock.calls.map((call) => call[1])).size).toBe(1);
  expect((await db.pool.query('SELECT * FROM driver_payout_accounts')).rows).toHaveLength(1);
  status.mockResolvedValue('ready');
  expect(await service.status(actor)).toEqual({ status: 'ready' });
  expect((await db.pool.query('SELECT approved,payout_ready FROM drivers')).rows[0]).toEqual({
    approved: false,
    payout_ready: false,
  });
  expect(JSON.stringify(createAccount.mock.calls)).not.toContain('Private driver');
});
test('old unresolved provisioning requires review before idempotency retention can lapse', async () => {
  createAccount.mockRejectedValueOnce(new Error('Uncertain'));
  await expect(service.start(actor)).rejects.toThrow();
  now = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  await expect(service.start(actor)).rejects.toMatchObject({ code: 'PAYOUT_SETUP_REVIEW' });
  expect(createAccount).toHaveBeenCalledTimes(1);
});
test('roles and disabled identities are checked against the database before provider calls', async () => {
  await expect(service.start({ ...actor, role: 'rider' })).rejects.toMatchObject({ status: 403 });
  await db.pool.query("UPDATE users SET role='rider' WHERE id=$1", [actor.id]);
  await expect(service.start(actor)).rejects.toMatchObject({ status: 403 });
  await db.pool.query("UPDATE users SET role='driver',disabled=true WHERE id=$1", [actor.id]);
  await expect(service.status(actor)).rejects.toMatchObject({ status: 403 });
  expect(createAccount).not.toHaveBeenCalled();
});
test('disablement during provisioning retains recovery mapping but withholds link', async () => {
  createAccount.mockImplementation(async () => {
    await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [actor.id]);
    return 'acct_fixture';
  });
  await expect(service.start(actor)).rejects.toMatchObject({ status: 403 });
  expect((await db.pool.query('SELECT account_id FROM driver_payout_accounts')).rows[0].account_id).toBe(
    'acct_fixture',
  );
  expect(onboardingLink).not.toHaveBeenCalled();
});
test('expired and untrusted links are withheld', async () => {
  onboardingLink.mockResolvedValueOnce({
    url: 'https://attacker.example/onboard',
    expiresAt: new Date(now.getTime() + 600000).toISOString(),
  });
  await expect(service.start(actor)).rejects.toThrow();
  onboardingLink.mockResolvedValueOnce({
    url: 'https://accounts.stripe.com/r/fixture',
    expiresAt: now.toISOString(),
  });
  await expect(service.start(actor)).rejects.toMatchObject({ code: 'PAYOUT_SETUP_UNAVAILABLE' });
});
test('provider errors do not turn a previous ready response into a cached ready state', async () => {
  await service.start(actor);
  status.mockResolvedValueOnce('ready');
  expect(await service.status(actor)).toEqual({ status: 'ready' });
  status.mockRejectedValueOnce(new Error('Provider unavailable'));
  await expect(service.status(actor)).rejects.toThrow();
});
test('provider is optional and source separates environments', async () => {
  expect(await service.status(actor)).toEqual({ status: 'not_started' });
  const off = new DriverPayouts(db.pool, 'acct_platform:test');
  expect(await off.status(actor)).toEqual({ status: 'unavailable' });
  await expect(off.start(actor)).rejects.toMatchObject({ status: 503 });
  await service.start(actor);
  expect(await new DriverPayouts(db.pool, 'acct_other:test', provider).status(actor)).toEqual({
    status: 'not_started',
  });
});

test('a conflicting provider result cannot overwrite a recorded account mapping', async () => {
  createAccount.mockImplementation(async () => {
    await db.pool.query("UPDATE driver_payout_accounts SET account_id='acct_recorded' WHERE driver_id=$1", [
      actor.id,
    ]);
    return 'acct_different';
  });
  await expect(service.start(actor)).rejects.toMatchObject({ code: 'PAYOUT_SETUP_UNAVAILABLE' });
  expect((await db.pool.query('SELECT account_id FROM driver_payout_accounts')).rows[0].account_id).toBe(
    'acct_recorded',
  );
  expect(onboardingLink).not.toHaveBeenCalled();
});
