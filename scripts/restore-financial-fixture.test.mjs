import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { tsImport } from 'tsx/esm/api';

const { testDatabase } = await tsImport('../packages/database/src/testing.ts', import.meta.url);
const { seedRestoreFinancialFixture, changeFinancialSourceAfterBackup, verifyRestoredFinancialFixture } =
  await tsImport('./restore-financial-fixture.mjs', import.meta.url);
const { Pool } = createRequire(new URL('../packages/database/package.json', import.meta.url))('pg');
let database;
let runtime;
let unrelatedRider;

before(
  async () => {
    database = await testDatabase();
    const password = randomBytes(32).toString('hex');
    await database.pool.query(
      `CREATE ROLE restore_verifier LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
    );
    await database.pool.query('GRANT USAGE ON SCHEMA public TO restore_verifier');
    await database.pool.query(
      'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO restore_verifier',
    );
    const url = new URL(database.connectionString);
    url.username = 'restore_verifier';
    url.password = password;
    runtime = new Pool({ connectionString: url.toString(), max: 3 });
  },
  { timeout: 60000 },
);

after(async () => {
  await runtime?.end();
  await database?.close();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  await database.pool.query('TRUNCATE outbox,audit CASCADE');
  unrelatedRider = randomUUID();
  await database.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1,$2,'Synthetic unrelated rider','rider')",
    [unrelatedRider, 'synthetic-verifier:' + unrelatedRider],
  );
});

test('financial verifier accepts intact records through a restricted runtime role', async () => {
  const fixture = await seedRestoreFinancialFixture(database.pool, runtime);
  const result = await verifyRestoredFinancialFixture(database.pool, runtime, fixture, unrelatedRider);
  assert.deepEqual(result, {
    restoredReceipt: true,
    balancedImmutableJournals: true,
    reconciliationRetry: true,
    reviewRetry: true,
    postBackupAcknowledgmentAbsent: true,
  });
});

test('financial verifier rejects an acknowledgment that should not exist at the backup point', async () => {
  const fixture = await seedRestoreFinancialFixture(database.pool, runtime);
  await changeFinancialSourceAfterBackup(runtime, fixture);
  await assert.rejects(
    verifyRestoredFinancialFixture(database.pool, runtime, fixture, unrelatedRider),
    (error) =>
      error.code === 'ERR_ASSERTION' &&
      error.operator === '==' &&
      error.actual === false &&
      error.expected === true,
  );
});

test('financial verifier rejects a receipt changed after the baseline was captured', async () => {
  const fixture = await seedRestoreFinancialFixture(database.pool, runtime);
  await database.pool.query('UPDATE rides SET fare_cents=fare_cents+1 WHERE id=$1', [
    fixture.reference.rideId,
  ]);
  await assert.rejects(
    verifyRestoredFinancialFixture(database.pool, runtime, fixture, unrelatedRider),
    (error) =>
      error.code === 'ERR_ASSERTION' &&
      error.operator === 'deepStrictEqual' &&
      error.actual?.quotedFare?.amount === 201 &&
      error.expected?.quotedFare?.amount === 200,
  );
});
