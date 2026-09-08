import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { transaction } from '@rove/server';
import { getEarnings } from './earnings-queries';
let db: Awaited<ReturnType<typeof testDatabase>>;
let driver: string;
let other: string;
let rider: string;
let binding: string;
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  driver = randomUUID();
  other = randomUUID();
  rider = randomUUID();
  binding = randomUUID();
  for (const [id, role] of [
    [driver, 'driver'],
    [other, 'driver'],
    [rider, 'rider'],
  ]) {
    await db.pool.query(
      "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Private name',$2)",
      [id, role],
    );
    if (role === 'driver') await db.pool.query('INSERT INTO drivers(id) VALUES($1)', [id]);
  }
  await db.pool.query(
    "INSERT INTO payment_customers(id,rider_id,source,customer_id) VALUES($1,$2,'acct_private:test','cus_private')",
    [binding, rider],
  );
});
async function entry(owner = driver, amount = 790, kind: string | null = 'allocation') {
  const quote = randomUUID(),
    ride = randomUUID(),
    attempt = randomUUID();
  await db.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
    quote,
    rider,
  ]);
  await db.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,driver_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,$4,'completed',1050,790,now())",
    [ride, quote, rider, owner],
  );
  await db.pool.query(
    "INSERT INTO payment_attempts(id,ride_id,customer_binding_id,intent_id,source,amount_cents) VALUES($1,$2,$3,$4,'acct_private:test',1050)",
    [attempt, ride, binding, 'pi_' + attempt.replaceAll('-', '')],
  );
  if (kind)
    await transaction(db.pool, async (client) => {
      const id = randomUUID();
      await client.query(
        "INSERT INTO ledger_journals(id,key,fingerprint,attempt_id,ride_id,kind,created_at) VALUES($1::uuid,$1::text,'fixture',$2,$3,$4,'2026-09-07T12:00:00Z')",
        [id, attempt, ride, kind],
      );
      await client.query(
        "INSERT INTO ledger_postings(journal_id,account,owner_id,amount_cents) VALUES($1,'rider_funds',$2,$4),($1,'driver_payable',$3,-$4)",
        [id, rider, owner, amount],
      );
    });
  return ride;
}
const read = () => getEarnings(db.pool, { id: driver, role: 'driver' });
test('completed trip estimates without allocations do not count as earnings', async () => {
  await entry(driver, 790, null);
  expect(await read()).toEqual({
    recordedTotal: { amount: 0, currency: 'USD' },
    entries: [],
    hasMore: false,
    nextCursor: null,
    payoutStatus: 'not_configured',
  });
});
test('only the driver owner sees allocations and private payment fields are absent', async () => {
  const mine = await entry();
  const theirs = await entry(other, 900);
  const result = await read();
  expect(result.recordedTotal.amount).toBe(790);
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0]?.rideId).toBe(mine);
  expect(Object.keys(result.entries[0]!).sort()).toEqual(['amount', 'id', 'recordedAt', 'rideId']);
  expect(JSON.stringify(result)).not.toMatch(/cus_private|acct_private|Private name/);
  expect(JSON.stringify(result)).not.toContain(theirs);
});
test('rider and staff roles cannot use the driver earnings query', async () => {
  for (const role of ['rider', 'staff'] as const)
    await expect(getEarnings(db.pool, { id: driver, role })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
});
test('the recent list is bounded while the total includes older allocations', async () => {
  for (let index = 0; index < 52; index++) await entry(driver, 10);
  const result = await read();
  expect(result.entries).toHaveLength(50);
  expect(result.recordedTotal.amount).toBe(520);
  expect(result.hasMore).toBe(true);
  const older = await getEarnings(db.pool, { id: driver, role: 'driver' }, result.nextCursor!);
  expect(older.entries).toHaveLength(2);
  expect(older.recordedTotal.amount).toBe(520);
  expect(older.nextCursor).toBeNull();
  expect(new Set([...result.entries, ...older.entries].map((entry) => entry.id)).size).toBe(52);
});
test('non-allocation journal kinds are excluded', async () => {
  await entry(driver, 790, 'capture');
  expect((await read()).recordedTotal.amount).toBe(0);
});

test('malformed, unknown and foreign-owner cursors are rejected', async () => {
  await entry(other);
  const foreign = await getEarnings(db.pool, { id: other, role: 'driver' });
  for (const before of ['not-a-cursor', randomUUID(), foreign.entries[0]!.id]) {
    await expect(getEarnings(db.pool, { id: driver, role: 'driver' }, before)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    });
  }
});
