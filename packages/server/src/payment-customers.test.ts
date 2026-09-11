import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { PaymentCustomers } from './payment-customers';
import { PaymentSessions } from './payment-sessions';
import type { PaymentCustomerProvider, PaymentProvider } from './payment-provider';
let database: Awaited<ReturnType<typeof testDatabase>>;
let actor: { id: string; role: 'rider' };
let now: Date;
let service: PaymentCustomers;
const source = 'acct_fixture:test';
const createCustomer = vi.fn<PaymentCustomerProvider['createCustomer']>();
beforeAll(async () => {
  database = await testDatabase();
}, 60000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  await database.pool.query('TRUNCATE outbox CASCADE');
  actor = { id: randomUUID(), role: 'rider' };
  now = new Date('2026-09-07T12:00:00Z');
  await database.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Private fixture name','rider')",
    [actor.id],
  );
  createCustomer.mockReset();
  createCustomer.mockResolvedValue('cus_fixture');
  service = new PaymentCustomers(database.pool, { createCustomer }, source, () => now);
});
test('customer creation journals immutable reference IDs before any network call and reuses the mapping', async () => {
  createCustomer.mockImplementation(async (reference) => {
    const rows = (await database.pool.query('SELECT * FROM payment_customers')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: reference.bindingId, rider_id: actor.id, customer_id: null });
    return 'cus_fixture';
  });
  await service.ensure(actor);
  await service.ensure(actor);
  expect(createCustomer).toHaveBeenCalledTimes(1);
  const [reference, key] = createCustomer.mock.calls[0]!;
  expect(reference).toEqual({ riderId: actor.id, bindingId: expect.any(String) });
  expect(key).toBe(`rove:${reference.bindingId}:customer`);
  expect(JSON.stringify(createCustomer.mock.calls)).not.toContain('Private fixture name');
});
test('parallel instances and uncertain outcomes share the same customer creation key', async () => {
  createCustomer.mockRejectedValueOnce(new Error('Unknown provider outcome'));
  await expect(service.ensure(actor)).rejects.toThrow('Unknown provider outcome');
  await Promise.all(
    Array.from({ length: 8 }, () =>
      new PaymentCustomers(database.pool, { createCustomer }, source, () => now).ensure(actor),
    ),
  );
  expect(new Set(createCustomer.mock.calls.map((call) => call[1])).size).toBe(1);
  expect((await database.pool.query('SELECT * FROM payment_customers')).rows).toHaveLength(1);
});
test('old unresolved provisioning is stopped before the provider idempotency retention boundary', async () => {
  createCustomer.mockRejectedValueOnce(new Error('Unknown outcome'));
  await expect(service.ensure(actor)).rejects.toThrow();
  now = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  await expect(service.ensure(actor)).rejects.toMatchObject({ code: 'PAYMENT_CUSTOMER_REVIEW' });
  expect(createCustomer).toHaveBeenCalledTimes(1);
});
test('disabled and non-rider database accounts cannot provision even if the caller supplies a rider role', async () => {
  await database.pool.query("UPDATE users SET role='driver' WHERE id=$1", [actor.id]);
  await expect(service.ensure(actor)).rejects.toMatchObject({ status: 403 });
  await database.pool.query("UPDATE users SET role='rider',disabled=true WHERE id=$1", [actor.id]);
  await expect(service.ensure(actor)).rejects.toMatchObject({ status: 403 });
  expect(createCustomer).not.toHaveBeenCalled();
  expect((await database.pool.query('SELECT * FROM payment_customers')).rows).toHaveLength(0);
});
test('disablement during provisioning retains the recovery mapping but refuses continued payment setup', async () => {
  createCustomer.mockImplementation(async () => {
    await database.pool.query('UPDATE users SET disabled=true WHERE id=$1', [actor.id]);
    return 'cus_fixture';
  });
  await expect(service.ensure(actor)).rejects.toMatchObject({ status: 403 });
  expect((await database.pool.query('SELECT customer_id FROM payment_customers')).rows[0].customer_id).toBe(
    'cus_fixture',
  );
});
test('a valid rider payment session provisions its customer automatically without accepting external references', async () => {
  const quote = randomUUID();
  const ride = randomUUID();
  await database.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',$3)", [
    quote,
    actor.id,
    new Date(now.getTime() + 60000),
  ]);
  await database.pool.query(
    'INSERT INTO rides(id,quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,1050,790,$4)',
    [ride, quote, actor.id, new Date(now.getTime() + 180000)],
  );
  const create = vi.fn<PaymentProvider['create']>(async (reference) => ({
    payment: {
      ...reference,
      intentId: 'pi_fixture',
      status: 'requires_payment_method',
      capturableCents: 0,
      receivedCents: 0,
    },
    clientSecret: 'pi_fixture_secret_private',
  }));
  const sessions = new PaymentSessions(
    database.pool,
    { create } as unknown as PaymentProvider,
    source,
    () => now,
    service,
  );
  await expect(sessions.create(actor, randomUUID())).rejects.toMatchObject({ status: 404 });
  expect(createCustomer).not.toHaveBeenCalled();
  expect(await sessions.create(actor, ride)).toEqual({
    rideId: ride,
    clientSecret: 'pi_fixture_secret_private',
  });
  expect(create.mock.calls[0]![0].customerId).toBe('cus_fixture');
  expect((await database.pool.query('SELECT intent_id FROM payment_attempts')).rows[0].intent_id).toBe(
    'pi_fixture',
  );
});

test.each(['valid', 'wrong_customer', 'disabled', 'cancelled', 'expired'])(
  'checkout customer session handles %s after provider I/O',
  async (scenario) => {
    const quote = randomUUID();
    const ride = randomUUID();
    await database.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',$3)", [
      quote,
      actor.id,
      new Date(now.getTime() + 60000),
    ]);
    await database.pool.query(
      'INSERT INTO rides(id,quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,1050,790,$4)',
      [ride, quote, actor.id, new Date(now.getTime() + 180000)],
    );
    const create = vi.fn<PaymentProvider['create']>(async (reference) => ({
      payment: {
        ...reference,
        intentId: 'pi_fixture',
        status: 'requires_payment_method',
        capturableCents: 0,
        receivedCents: 0,
      },
      clientSecret: 'pi_fixture_secret_private',
    }));
    const customerSession = vi.fn(async () => {
      if (scenario === 'disabled')
        await database.pool.query('UPDATE users SET disabled=true WHERE id=$1', [actor.id]);
      if (scenario === 'cancelled')
        await database.pool.query("UPDATE rides SET state='cancelled' WHERE id=$1", [ride]);
      if (scenario === 'expired') now = new Date(now.getTime() + 180001);
      return {
        customerId: scenario === 'wrong_customer' ? 'cus_other' : 'cus_fixture',
        clientSecret: 'synthetic_customer_secret',
      };
    });
    const sessions = new PaymentSessions(
      database.pool,
      { create } as unknown as PaymentProvider,
      source,
      () => now,
      service,
      { customerSession },
    );
    if (scenario === 'valid') {
      await expect(sessions.create(actor, ride)).resolves.toMatchObject({
        rideId: ride,
        customer: { customerId: 'cus_fixture', clientSecret: 'synthetic_customer_secret' },
      });
    } else {
      await expect(sessions.create(actor, ride)).rejects.toMatchObject({
        code: scenario === 'wrong_customer' ? 'PAYMENT_REFERENCE_MISMATCH' : 'PAYMENT_SESSION_UNAVAILABLE',
      });
    }
    expect(customerSession).toHaveBeenCalledWith('cus_fixture', 'payment');
    expect((await database.pool.query('SELECT intent_id FROM payment_attempts')).rows[0].intent_id).toBe(
      'pi_fixture',
    );
    expect(
      (await database.pool.query("SELECT * FROM outbox WHERE topic='payment.reconcile'")).rows,
    ).toHaveLength(1);
  },
);
