import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createDatabase } from '@rove/database';
import { testDatabase } from '@rove/database/testing';
import { transaction } from './transactions';
import { bindPaymentAttemptRead, bindPaymentAttemptWrite } from './payment-attempt-scope';
import { bindPaymentCustomerRead } from './payment-customer-scope';
let db: Awaited<ReturnType<typeof testDatabase>>;
let runtime: ReturnType<typeof createDatabase>;
let records: { id: string; ride: string; binding: string; source: string; intent: string }[];
beforeAll(async () => {
  db = await testDatabase();
  const password = randomBytes(32).toString('hex');
  await db.pool.query(`CREATE ROLE payment_read_probe LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
  await db.pool.query('GRANT USAGE ON SCHEMA public TO payment_read_probe');
  await db.pool.query(
    'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO payment_read_probe',
  );
  // Disposable read-policy prototype; the application migration is not enabled yet.
  await db.pool
    .query(`ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY; ALTER TABLE payment_attempts FORCE ROW LEVEL SECURITY;
 CREATE POLICY payment_read_probe ON payment_attempts FOR SELECT USING (
 source=NULLIF(current_setting('rove.payment_attempt_read',true),'')::jsonb->>'source' AND (
 id=(NULLIF(current_setting('rove.payment_attempt_read',true),'')::jsonb->>'attemptId')::uuid OR
 ride_id=(NULLIF(current_setting('rove.payment_attempt_read',true),'')::jsonb->>'rideId')::uuid OR
 intent_id=NULLIF(current_setting('rove.payment_attempt_read',true),'')::jsonb->>'intentId'));`);
  await db.pool.query(`CREATE POLICY payment_write_probe ON payment_attempts FOR UPDATE USING (
    jsonb_build_object('attemptId',id,'rideId',ride_id,'bindingId',customer_binding_id,'source',source,'amountCents',amount_cents)
    = (NULLIF(current_setting('rove.payment_attempt_write',true),'')::jsonb-'intentId')
    AND (intent_id IS NULL OR intent_id=NULLIF(current_setting('rove.payment_attempt_write',true),'')::jsonb->>'intentId'))
    WITH CHECK (jsonb_build_object('attemptId',id,'rideId',ride_id,'bindingId',customer_binding_id,'source',source,'amountCents',amount_cents,'intentId',intent_id)
    = NULLIF(current_setting('rove.payment_attempt_write',true),'')::jsonb);`);
  const connection = new URL(db.connectionString);
  connection.username = 'payment_read_probe';
  connection.password = password;
  runtime = createDatabase(connection.toString());
}, 60000);
afterAll(async () => {
  await runtime?.close();
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  records = [];
  for (const source of ['acct_scope:test', 'acct_scope:test', 'acct_other:test']) {
    const rider = randomUUID(),
      ride = randomUUID(),
      quote = randomUUID(),
      binding = randomUUID(),
      id = randomUUID();
    // Deliberately duplicate an intent across provider sources to prove source isolation.
    const intent = records.length === 1 ? 'pi_second' : 'pi_shared';
    await db.pool.query(
      "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Synthetic','rider')",
      [rider],
    );
    await db.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
      quote,
      rider,
    ]);
    await db.pool.query(
      'INSERT INTO rides(id,quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,1000,800,now())',
      [ride, quote, rider],
    );
    await db.pool.query('INSERT INTO payment_customers(id,rider_id,source,customer_id) VALUES($1,$2,$3,$4)', [
      binding,
      rider,
      source,
      'cus_' + id.replaceAll('-', ''),
    ]);
    await db.pool.query(
      'INSERT INTO payment_attempts(id,ride_id,customer_binding_id,source,intent_id,amount_cents) VALUES($1,$2,$3,$4,$5,1000)',
      [id, ride, binding, source, intent],
    );
    records.push({ id, ride, binding, source, intent });
  }
});
test('each lookup selects only its exact payment and provider source', async () => {
  const row = records[0]!;
  expect((await runtime.pool.query('SELECT * FROM payment_attempts')).rowCount).toBe(0);
  for (const ref of [{ attemptId: row.id }, { rideId: row.ride }, { intentId: row.intent }])
    await transaction(runtime.pool, async (c) => {
      await bindPaymentAttemptRead(c, row.source, ref);
      expect((await c.query('SELECT id FROM payment_attempts')).rows).toEqual([{ id: row.id }]);
      expect((await c.query('UPDATE payment_attempts SET amount_cents=1')).rowCount).toBe(0);
      expect((await c.query('DELETE FROM payment_attempts')).rowCount).toBe(0);
    });
  expect((await runtime.pool.query('SELECT * FROM payment_attempts')).rowCount).toBe(0);
  await transaction(runtime.pool, async (c) => {
    await bindPaymentAttemptRead(c, 'acct_other:test', { attemptId: row.id });
    expect((await c.query('SELECT * FROM payment_attempts')).rowCount).toBe(0);
  });
});
test('customer lookup resolves the selected persisted binding and clears a missing lookup', async () => {
  const row = records[0]!;
  await transaction(runtime.pool, async (c) => {
    await bindPaymentCustomerRead(c, row.source, { intentId: row.intent });
    expect((await c.query('SELECT id FROM payment_customers')).rows).toEqual([{ id: row.binding }]);
    await bindPaymentCustomerRead(c, row.source, { attemptId: randomUUID() });
    expect((await c.query('SELECT id FROM payment_attempts')).rowCount).toBe(0);
    expect((await c.query('SELECT id FROM payment_customers')).rowCount).toBe(0);
  });
});
test('invalid provider or ambiguous references cannot establish a lookup scope', async () => {
  await expect(
    transaction(runtime.pool, (c) => bindPaymentAttemptRead(c, 'not-a-source', { intentId: 'pi_shared' })),
  ).rejects.toThrow();
  await expect(
    transaction(runtime.pool, (c) =>
      bindPaymentAttemptRead(c, 'acct_scope:test', { intentId: 'pi_shared', rideId: randomUUID() }),
    ),
  ).rejects.toThrow();
  expect((await runtime.pool.query('SELECT * FROM payment_attempts')).rowCount).toBe(0);
});

test('verified result scope preserves the exact payment while rejecting retargeted writes', async () => {
  const row = records[0]!,
    other = records[1]!;
  const scope = {
    attemptId: row.id,
    rideId: row.ride,
    bindingId: row.binding,
    source: row.source,
    amountCents: 1000,
    intentId: row.intent,
  };
  await transaction(runtime.pool, async (c) => {
    await bindPaymentAttemptWrite(c, scope);
    expect(
      (
        await c.query(
          "UPDATE payment_attempts SET provider_status='succeeded',revision=revision+1 WHERE id=$1",
          [other.id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await c.query(
          "UPDATE payment_attempts SET provider_status='succeeded',revision=revision+1 WHERE id=$1",
          [row.id],
        )
      ).rowCount,
    ).toBe(1);
    await bindPaymentAttemptRead(c, row.source, { attemptId: row.id });
    expect(
      (await c.query('UPDATE payment_attempts SET revision=revision+1 WHERE id=$1', [row.id])).rowCount,
    ).toBe(0);
  });
  await expect(
    transaction(runtime.pool, async (c) => {
      await bindPaymentAttemptWrite(c, scope);
      await c.query('UPDATE payment_attempts SET amount_cents=500 WHERE id=$1', [row.id]);
    }),
  ).rejects.toMatchObject({ code: '42501' });
  await transaction(runtime.pool, async (c) => {
    await bindPaymentAttemptWrite(c, { ...scope, intentId: 'pi_retargeted' });
    expect(
      (await c.query("UPDATE payment_attempts SET intent_id='pi_retargeted' WHERE id=$1", [row.id])).rowCount,
    ).toBe(0);
  });
});
test('a verified in-flight result remains recordable after owner disablement', async () => {
  const row = records[0]!;
  await db.pool.query('UPDATE payment_attempts SET intent_id=NULL WHERE id=$1', [row.id]);
  await db.pool.query('UPDATE users SET disabled=true WHERE id=(SELECT rider_id FROM rides WHERE id=$1)', [
    row.ride,
  ]);
  await transaction(runtime.pool, async (c) => {
    await bindPaymentAttemptWrite(c, {
      attemptId: row.id,
      rideId: row.ride,
      bindingId: row.binding,
      source: row.source,
      amountCents: 1000,
      intentId: row.intent,
    });
    expect(
      (await c.query('UPDATE payment_attempts SET intent_id=$2 WHERE id=$1', [row.id, row.intent])).rowCount,
    ).toBe(1);
  });
  expect((await runtime.pool.query('SELECT * FROM payment_attempts')).rowCount).toBe(0);
});
