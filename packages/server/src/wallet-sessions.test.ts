import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { PaymentCustomers } from './payment-customers';
import { WalletSessions, type WalletProvider } from './wallet-sessions';
let database: Awaited<ReturnType<typeof testDatabase>>;
let actor: { id: string; role: 'rider' };
let service: WalletSessions;
const customerSession = vi.fn<WalletProvider['customerSession']>();
const setupSession = vi.fn<WalletProvider['setupSession']>();
const source = 'acct_wallet:test';
beforeAll(async () => {
  database = await testDatabase();
}, 60000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  actor = { id: randomUUID(), role: 'rider' };
  await database.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1,$2,'Synthetic Rider','rider')",
    [actor.id, actor.id],
  );
  customerSession
    .mockReset()
    .mockImplementation(async (customerId) => ({ customerId, clientSecret: 'synthetic-session-secret' }));
  setupSession.mockReset().mockResolvedValue({ clientSecret: 'synthetic-setup-secret' });
  const customers = new PaymentCustomers(database.pool, { createCustomer: async () => 'cus_wallet' }, source);
  service = new WalletSessions(database.pool, { customerSession, setupSession }, customers, source);
});
test('settings access uses the current source mapping and never stores client secrets', async () => {
  await database.pool.query('INSERT INTO payment_customers(rider_id,source,customer_id) VALUES($1,$2,$3)', [
    actor.id,
    'acct_other:test',
    'cus_other',
  ]);
  expect(await service.customerSession(actor)).toEqual({
    customerId: 'cus_wallet',
    clientSecret: 'synthetic-session-secret',
  });
  expect(customerSession).toHaveBeenCalledWith('cus_wallet');
  expect(JSON.stringify((await database.pool.query('SELECT * FROM payment_customers')).rows)).not.toContain(
    'secret',
  );
});
test('disabled or non-rider accounts cannot request provider access', async () => {
  await expect(service.customerSession({ ...actor, role: 'driver' })).rejects.toMatchObject({ status: 403 });
  await database.pool.query('UPDATE users SET disabled=true WHERE id=$1', [actor.id]);
  await expect(service.customerSession(actor)).rejects.toMatchObject({ status: 403 });
  expect(customerSession).not.toHaveBeenCalled();
});
test('setup retries keep the same key and different setup requests get new keys', async () => {
  const requestId = randomUUID();
  await service.setupSession(actor, requestId);
  await service.setupSession(actor, requestId);
  await service.setupSession(actor, randomUUID());
  expect(setupSession.mock.calls[0]).toEqual(setupSession.mock.calls[1]);
  expect(setupSession.mock.calls[2]?.[1]).not.toBe(setupSession.mock.calls[0]?.[1]);
});
test('malformed setup IDs fail before provisioning or provider calls', async () => {
  await expect(service.setupSession(actor, 'bad')).rejects.toMatchObject({ status: 422 });
  expect(setupSession).not.toHaveBeenCalled();
  expect((await database.pool.query('SELECT * FROM payment_customers')).rows).toHaveLength(0);
});
test('disablement while a session is being issued prevents returning its secret', async () => {
  customerSession.mockImplementation(async (customerId) => {
    await database.pool.query('UPDATE users SET disabled=true WHERE id=$1', [actor.id]);
    return { customerId, clientSecret: 'must-not-return' };
  });
  await expect(service.customerSession(actor)).rejects.toMatchObject({ status: 403 });
});
test('a provider customer mismatch is rejected', async () => {
  customerSession.mockResolvedValue({ customerId: 'cus_other', clientSecret: 'must-not-return' });
  await expect(service.customerSession(actor)).rejects.toMatchObject({ code: 'PAYMENT_REFERENCE_MISMATCH' });
});
test('a changed mapping while setup is pending prevents returning its secret', async () => {
  setupSession.mockImplementation(async () => {
    await database.pool.query('UPDATE payment_customers SET customer_id=$1 WHERE rider_id=$2', [
      'cus_changed',
      actor.id,
    ]);
    return { clientSecret: 'must-not-return' };
  });
  await expect(service.setupSession(actor, randomUUID())).rejects.toMatchObject({
    code: 'PAYMENT_REFERENCE_MISMATCH',
  });
});
