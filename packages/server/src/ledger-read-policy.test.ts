import { createDatabase } from '@rove/database';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { transaction } from './transactions';
import { recordCapturedFunds } from './ledger';
let database: Awaited<ReturnType<typeof testDatabase>>;
let runtime: ReturnType<typeof createDatabase>;
let input: Parameters<typeof recordCapturedFunds>[1];
beforeAll(async () => {
  database = await testDatabase();
  const password = randomBytes(32).toString('hex');
  await database.pool.query(
    `CREATE ROLE ledger_policy_probe LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
  );
  await database.pool.query('GRANT USAGE ON SCHEMA public TO ledger_policy_probe');
  await database.pool.query(
    'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ledger_policy_probe',
  );
  const connection = new URL(database.connectionString);
  connection.username = 'ledger_policy_probe';
  connection.password = password;
  runtime = createDatabase(connection.toString());
  // Local policy prototype: validate explicit posting scope before generating a deployable migration.
  await database.pool.query(`
    ALTER TABLE ledger_journals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ledger_journals FORCE ROW LEVEL SECURITY;
    ALTER TABLE ledger_postings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ledger_postings FORCE ROW LEVEL SECURITY;
    CREATE POLICY probe_journal_read ON ledger_journals FOR SELECT USING(attempt_id=NULLIF(current_setting('rove.ledger_attempt',true),'')::uuid);
    CREATE POLICY probe_posting_read ON ledger_postings FOR SELECT USING(
      EXISTS(SELECT 1 FROM ledger_journals j WHERE j.id=journal_id AND j.attempt_id=NULLIF(current_setting('rove.ledger_attempt',true),'')::uuid)
      OR owner_id=NULLIF(current_setting('rove.ledger_owner',true),'')::uuid);
  `);
}, 60000);
afterAll(async () => {
  await runtime?.close();
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
test('unscoped ledger access is denied; payment scope reveals only its own journal and postings', async () => {
  await transaction(database.pool, (c) => recordCapturedFunds(c, input));
  expect((await runtime.pool.query('SELECT * FROM ledger_journals')).rowCount).toBe(0);
  expect((await runtime.pool.query('SELECT * FROM ledger_postings')).rowCount).toBe(0);
  await transaction(runtime.pool, async (c) => {
    await c.query("SELECT set_config('rove.ledger_attempt',$1,true)", [randomUUID()]);
    expect((await c.query('SELECT * FROM ledger_postings')).rowCount).toBe(0);
    await c.query("SELECT set_config('rove.ledger_attempt',$1,true)", [input.attemptId]);
    expect((await c.query('SELECT * FROM ledger_journals')).rowCount).toBe(2);
    expect((await c.query('SELECT * FROM ledger_postings')).rowCount).toBe(5);
    expect((await c.query('DELETE FROM ledger_postings')).rowCount).toBe(0);
    expect((await c.query("UPDATE ledger_journals SET kind='forged'")).rowCount).toBe(0);
  });
  expect((await runtime.pool.query('SELECT * FROM ledger_postings')).rowCount).toBe(0);
});
test('closure balance scope sees only that owner and no journal headers', async () => {
  await transaction(database.pool, (c) => recordCapturedFunds(c, input));
  await transaction(runtime.pool, async (c) => {
    await c.query("SELECT set_config('rove.ledger_owner',$1,true)", [input.driverId]);
    const rows = (await c.query('SELECT owner_id,amount_cents FROM ledger_postings')).rows;
    expect(rows).toEqual([{ owner_id: input.driverId, amount_cents: -790 }]);
    expect((await c.query('SELECT * FROM ledger_journals')).rowCount).toBe(0);
    await c.query("SELECT set_config('rove.ledger_owner',$1,true)", [randomUUID()]);
    expect((await c.query('SELECT * FROM ledger_postings')).rowCount).toBe(0);
  });
});
