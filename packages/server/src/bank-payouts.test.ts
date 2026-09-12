import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { BankPayouts, type BankPayoutProvider } from './bank-payouts';
let db: Awaited<ReturnType<typeof testDatabase>>;
let actor: { id: string; role: 'driver' }, binding: string, service: BankPayouts;
const list = vi.fn<BankPayoutProvider['list']>();
const source = 'acct_platform:test';
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  actor = { id: randomUUID(), role: 'driver' };
  binding = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Fixture driver','driver')",
    [actor.id],
  );
  await db.pool.query('INSERT INTO drivers(id) VALUES($1)', [actor.id]);
  await db.pool.query(
    "INSERT INTO driver_payout_accounts(id,driver_id,source,account_id) VALUES($1,$2,$3,'acct_driver')",
    [binding, actor.id, source],
  );
  list.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  service = new BankPayouts(db.pool, source, { list });
});
test('returns verified current history only for the signed-in driver binding', async () => {
  expect(await service.list(actor)).toMatchObject({ status: 'available', items: [], nextCursor: null });
  expect(list).toHaveBeenCalledWith(
    { driverId: actor.id, bindingId: binding, accountId: 'acct_driver' },
    undefined,
  );
  expect(await new BankPayouts(db.pool, source).list(actor)).toEqual({
    status: 'unavailable',
    items: [],
    nextCursor: null,
    checkedAt: null,
  });
  expect(await new BankPayouts(db.pool, 'acct_other:test', { list }).list(actor)).toMatchObject({
    status: 'not_started',
  });
});
test('rejects role spoofing and disablement before provider access', async () => {
  await expect(service.list({ ...actor, role: 'rider' })).rejects.toMatchObject({ status: 403 });
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [actor.id]);
  await expect(service.list(actor)).rejects.toMatchObject({ status: 403 });
  expect(list).not.toHaveBeenCalled();
});
test('rechecks disablement after the provider responds', async () => {
  list.mockImplementation(async () => {
    await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [actor.id]);
    return { items: [], nextCursor: null };
  });
  await expect(service.list(actor)).rejects.toMatchObject({ status: 403 });
});
test('cannot expose an old account response after payout binding changes', async () => {
  list.mockImplementation(async () => {
    await db.pool.query("UPDATE driver_payout_accounts SET account_id='acct_new' WHERE id=$1", [binding]);
    return { items: [], nextCursor: null };
  });
  await expect(service.list(actor)).rejects.toMatchObject({ code: 'PAYOUT_HISTORY_CHANGED' });
});
test('rejects invalid cursors and responses, and never substitutes an empty history for provider failure', async () => {
  await expect(service.list(actor, 'acct_other')).rejects.toThrow();
  expect(list).not.toHaveBeenCalled();
  list.mockRejectedValue(new Error('provider unavailable'));
  await expect(service.list(actor)).rejects.toThrow('provider unavailable');
  list.mockResolvedValue({ items: [], nextCursor: 'po_missing' });
  await expect(service.list(actor)).rejects.toThrow();
});
