import { bindUserRead } from './user-scope';
import { actorTransaction } from './actor-transaction';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createDatabase } from '@rove/database';
import { testDatabase } from '@rove/database/testing';
import { transaction } from './transactions';
import {
  bindPaymentAttemptRead,
  bindPaymentAttemptWrite,
  bindPaymentAttemptScan,
} from './payment-attempt-scope';
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
      await c.query('SAVEPOINT denied_write');
      await expect(c.query('UPDATE payment_attempts SET amount_cents=500')).rejects.toMatchObject({
        code: '42501',
      });
      await c.query('ROLLBACK TO SAVEPOINT denied_write');
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
    await c.query('SAVEPOINT denied_write');
    await expect(
      c.query('UPDATE payment_attempts SET revision=revision+1 WHERE id=$1', [row.id]),
    ).rejects.toMatchObject({ code: '42501' });
    await c.query('ROLLBACK TO SAVEPOINT denied_write');
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

test('recovery scans expose only the selected provider and cannot mutate attempts', async () => {
  await transaction(runtime.pool, async (c) => {
    await bindPaymentAttemptScan(c, 'acct_scope:test');
    expect(
      (await c.query('SELECT id FROM payment_attempts ORDER BY id')).rows.map((r) => r.id).sort(),
    ).toEqual(
      records
        .slice(0, 2)
        .map((r) => r.id)
        .sort(),
    );
    expect((await c.query('SELECT id FROM payment_attempts FOR UPDATE')).rowCount).toBe(2);
    await expect(
      c.query("UPDATE payment_attempts SET provider_status='succeeded' WHERE id=$1", [records[0]!.id]),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
test('rider creation requires its own ride, customer binding and unchanged fare', async () => {
  const row = records[0]!,
    foreign = records[1]!;
  const rider = (await db.pool.query('SELECT rider_id FROM rides WHERE id=$1', [row.ride])).rows[0].rider_id;
  await db.pool.query('DELETE FROM payment_attempts WHERE id=$1', [row.id]);
  const actor = { id: rider, role: 'rider' as const };
  for (const [binding, amount] of [
    [foreign.binding, 1000],
    [row.binding, 500],
  ] as const) {
    await expect(
      actorTransaction(runtime.pool, actor, async (c) => {
        await c.query("SELECT set_config('rove.customer_source',$1,true)", [row.source]);
        await c.query(
          'INSERT INTO payment_attempts(ride_id,customer_binding_id,source,amount_cents) VALUES($1,$2,$3,$4)',
          [row.ride, binding, row.source, amount],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });
  }
  await actorTransaction(runtime.pool, actor, async (c) => {
    await c.query("SELECT set_config('rove.customer_source',$1,true)", [row.source]);
    expect(
      (
        await c.query(
          'INSERT INTO payment_attempts(ride_id,customer_binding_id,source,amount_cents) VALUES($1,$2,$3,1000) RETURNING id',
          [row.ride, row.binding, row.source],
        )
      ).rowCount,
    ).toBe(1);
    expect((await c.query('SELECT id FROM payment_attempts FOR UPDATE')).rowCount).toBe(1);
  });
});
test('closure locks require staff MFA and permission and stay with the selected owner', async () => {
  const staff = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Synthetic staff','staff')",
    [staff],
  );
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.close')", [
    staff,
  ]);
  const row = records[0]!;
  const rider = (await db.pool.query('SELECT rider_id FROM rides WHERE id=$1', [row.ride])).rows[0].rider_id;
  for (const mfa of [false, true])
    await actorTransaction(runtime.pool, { id: staff, role: 'staff', mfa }, async (c) => {
      await bindUserRead(c, rider);
      await c.query("SELECT set_config('rove.payment_attempt_closure',$1,true)", [rider]);
      expect((await c.query('SELECT id FROM payment_attempts FOR UPDATE')).rows).toEqual(
        mfa ? [{ id: row.id }] : [],
      );
    });
  await db.pool.query('DELETE FROM staff_permissions WHERE staff_id=$1', [staff]);
  await actorTransaction(runtime.pool, { id: staff, role: 'staff', mfa: true }, async (c) => {
    await bindUserRead(c, rider);
    await c.query("SELECT set_config('rove.payment_attempt_closure',$1,true)", [rider]);
    expect((await c.query('SELECT id FROM payment_attempts')).rowCount).toBe(0);
  });
});
