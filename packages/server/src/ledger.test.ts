import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { transaction } from './transactions';
import { recordCapturedFunds } from './ledger';
let database: Awaited<ReturnType<typeof testDatabase>>;
let input: Parameters<typeof recordCapturedFunds>[1];
beforeAll(async () => {
  database = await testDatabase();
}, 60000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  const rider = randomUUID();
  const driver = randomUUID();
  const quote = randomUUID();
  const ride = randomUUID();
  const attempt = randomUUID();
  const binding = randomUUID();
  for (const [id, role] of [
    [rider, 'rider'],
    [driver, 'driver'],
  ])
    await database.pool.query(
      "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Fixture',$2)",
      [id, role],
    );
  await database.pool.query('INSERT INTO drivers(id) VALUES($1)', [driver]);
  await database.pool.query(
    "INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now()+interval '1 minute')",
    [quote, rider],
  );
  await database.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,driver_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,$4,'completed',1050,790,now())",
    [ride, quote, rider, driver],
  );
  await database.pool.query(
    "INSERT INTO payment_customers(id,rider_id,source,customer_id) VALUES($1,$2,'acct_fixture:test','cus_fixture')",
    [binding, rider],
  );
  await database.pool.query(
    "INSERT INTO payment_attempts(id,ride_id,customer_binding_id,intent_id,source,amount_cents) VALUES($1,$2,$3,'pi_fixture','acct_fixture:test',1050)",
    [attempt, ride, binding],
  );
  input = {
    attemptId: attempt,
    rideId: ride,
    riderId: rider,
    driverId: driver,
    receivedCents: 1050,
    earningsCents: 790,
    completed: true,
    fullFare: true,
  };
});
test('concurrent capture retries produce one balanced capture and one earnings allocation', async () => {
  await Promise.all([
    transaction(database.pool, (c) => recordCapturedFunds(c, input)),
    transaction(database.pool, (c) => recordCapturedFunds(c, input)),
  ]);
  expect((await database.pool.query('SELECT * FROM ledger_journals')).rows).toHaveLength(2);
  expect((await database.pool.query('SELECT * FROM ledger_postings')).rows).toHaveLength(5);
  const sums = (
    await database.pool.query(
      'SELECT account,SUM(amount_cents)::int AS total FROM ledger_postings GROUP BY account ORDER BY account',
    )
  ).rows;
  expect(sums).toEqual([
    { account: 'driver_payable', total: -790 },
    { account: 'platform_revenue', total: -260 },
    { account: 'rider_funds', total: 0 },
    { account: 'stripe_clearing', total: 1050 },
  ]);
});
test('partial captured funds remain a rider liability without claiming driver earnings', async () => {
  expect(
    await transaction(database.pool, (c) =>
      recordCapturedFunds(c, { ...input, receivedCents: 500, fullFare: false }),
    ),
  ).toBe(false);
  expect((await database.pool.query('SELECT kind FROM ledger_journals')).rows).toEqual([{ kind: 'capture' }]);
  expect(
    (
      await database.pool.query(
        "SELECT SUM(amount_cents)::int AS total FROM ledger_postings WHERE account='rider_funds'",
      )
    ).rows[0].total,
  ).toBe(-500);
  await expect(transaction(database.pool, (c) => recordCapturedFunds(c, input))).rejects.toMatchObject({
    code: 'LEDGER_CONFLICT',
  });
});
test('empty and unbalanced journals cannot commit even through direct SQL', async () => {
  for (const amount of [null, 100]) {
    await expect(
      transaction(database.pool, async (client) => {
        const header = (
          await client.query(
            'INSERT INTO ledger_journals(key,fingerprint,attempt_id,ride_id,kind) VALUES($1,$2,$3,$4,$5) RETURNING id',
            [randomUUID(), 'fixture', input.attemptId, input.rideId, 'capture'],
          )
        ).rows[0];
        if (amount !== null)
          await client.query(
            "INSERT INTO ledger_postings(journal_id,account,amount_cents) VALUES($1,'stripe_clearing',$2)",
            [header.id, amount],
          );
      }),
    ).rejects.toMatchObject({ code: '23514' });
  }
  expect((await database.pool.query('SELECT * FROM ledger_journals')).rows).toHaveLength(0);
});
test('committed journals cannot be changed, deleted or extended with extra balanced postings', async () => {
  await transaction(database.pool, (c) => recordCapturedFunds(c, input));
  for (const sql of [
    'UPDATE ledger_postings SET amount_cents=amount_cents+1',
    'DELETE FROM ledger_postings',
    "UPDATE ledger_journals SET fingerprint='changed'",
    'DELETE FROM ledger_journals',
  ])
    await expect(database.pool.query(sql)).rejects.toMatchObject({ code: '23514' });
  const id = (await database.pool.query('SELECT id FROM ledger_journals LIMIT 1')).rows[0].id;
  await expect(
    transaction(database.pool, async (client) => {
      await client.query(
        "INSERT INTO ledger_postings(journal_id,account,amount_cents) VALUES($1,'stripe_clearing',100),($1,'platform_revenue',-100)",
        [id],
      );
    }),
  ).rejects.toMatchObject({ code: '23514' });
  expect((await database.pool.query('SELECT * FROM ledger_postings')).rows).toHaveLength(5);
});
test('ledger and ride funding roll back together on a later transaction failure', async () => {
  await expect(
    transaction(database.pool, async (client) => {
      await recordCapturedFunds(client, input);
      await client.query("UPDATE rides SET payment_state='paid' WHERE id=$1", [input.rideId]);
      throw new Error('Fixture transaction failure');
    }),
  ).rejects.toThrow('Fixture transaction failure');
  expect((await database.pool.query('SELECT * FROM ledger_journals')).rows).toHaveLength(0);
  expect(
    (await database.pool.query('SELECT payment_state FROM rides WHERE id=$1', [input.rideId])).rows[0]
      .payment_state,
  ).toBe('pending');
});
test('invalid earnings cannot allocate more than captured funds', async () => {
  expect(
    await transaction(database.pool, (c) => recordCapturedFunds(c, { ...input, earningsCents: 2000 })),
  ).toBe(false);
  expect((await database.pool.query('SELECT kind FROM ledger_journals')).rows).toEqual([{ kind: 'capture' }]);
});
