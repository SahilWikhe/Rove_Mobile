import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { transaction } from '@rove/server';
import { getEarnings, getTripEarnings } from './earnings-queries';
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
async function entry(
  owner = driver,
  amount = 790,
  kind: string | null = 'allocation',
  recordedAt = '2026-09-07T12:00:00Z',
) {
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
        "INSERT INTO ledger_journals(id,key,fingerprint,attempt_id,ride_id,kind,created_at) VALUES($1::uuid,$1::text,'fixture',$2,$3,$4,$5)",
        [id, attempt, ride, kind, recordedAt],
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

test('trip earnings distinguish a completed estimate from an allocated payment', async () => {
  const pending = await entry(driver, 790, null);
  expect(await getTripEarnings(db.pool, { id: driver, role: 'driver' }, pending)).toEqual({
    rideId: pending,
    estimatedAmount: { amount: 790, currency: 'USD' },
    recordedAmount: null,
    recordedAt: null,
    payoutStatus: 'not_configured',
  });
  const recorded = await entry(driver, 700);
  const result = await getTripEarnings(db.pool, { id: driver, role: 'driver' }, recorded);
  expect(result.recordedAmount).toEqual({ amount: 700, currency: 'USD' });
  expect(result.estimatedAmount.amount).toBe(790);
  expect(result.recordedAt).toBe('2026-09-07T12:00:00.000Z');
  expect(JSON.stringify(result)).not.toMatch(/cus_private|acct_private|Private name/);
});
test('trip earnings require the assigned driver and a completed trip', async () => {
  const ride = await entry();
  for (const actor of [
    { id: other, role: 'driver' as const },
    { id: rider, role: 'rider' as const },
    { id: driver, role: 'staff' as const },
  ]) {
    await expect(getTripEarnings(db.pool, actor, ride)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }
  await db.pool.query("UPDATE rides SET state='in_progress' WHERE id=$1", [ride]);
  await expect(getTripEarnings(db.pool, { id: driver, role: 'driver' }, ride)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});

test('duplicate allocation journals require review instead of displaying doubled earnings', async () => {
  const ride = await entry();
  await transaction(db.pool, async (client) => {
    const duplicate = randomUUID();
    await client.query(
      `INSERT INTO ledger_journals(id,key,fingerprint,attempt_id,ride_id,kind)
       SELECT $1::uuid,$1::text,'duplicate-fixture',attempt_id,ride_id,kind
       FROM ledger_journals WHERE ride_id=$2 LIMIT 1`,
      [duplicate, ride],
    );
    await client.query(
      `INSERT INTO ledger_postings(journal_id,account,owner_id,amount_cents)
       VALUES($1,'rider_funds',$2,790),($1,'driver_payable',$3,-790)`,
      [duplicate, rider, driver],
    );
  });
  await expect(getTripEarnings(db.pool, { id: driver, role: 'driver' }, ride)).rejects.toMatchObject({
    code: 'EARNINGS_REVIEW_REQUIRED',
    status: 409,
  });
});

test('UTC date filtering includes both full dates and keeps lifetime totals separate', async () => {
  const times = [
    '2026-09-06T23:59:59.999Z',
    '2026-09-07T00:00:00Z',
    '2026-09-08T23:59:59.999Z',
    '2026-09-09T00:00:00Z',
  ];
  const rides = [];
  for (const time of times) {
    const ride = await entry(driver, 100, 'allocation', time);
    rides.push(ride);
  }
  await entry(other, 900);
  const result = await getEarnings(db.pool, { id: driver, role: 'driver' }, undefined, {
    from: '2026-09-07',
    through: '2026-09-08',
  });
  expect(result.recordedTotal.amount).toBe(400);
  expect(result.periodTotal?.amount).toBe(200);
  expect(result.entries.map((row) => row.rideId)).toEqual([rides[2], rides[1]]);
  const empty = await getEarnings(db.pool, { id: driver, role: 'driver' }, undefined, {
    from: '2026-10-01',
    through: '2026-10-01',
  });
  expect(empty.entries).toEqual([]);
  expect(empty.periodTotal?.amount).toBe(0);
  expect(empty.recordedTotal.amount).toBe(400);
});
test.each([
  { from: '2026-02-30', through: '2026-03-01' },
  { from: '2026-09-09', through: '2026-09-07' },
])('rejects invalid date ranges %j', async (range) => {
  await expect(getEarnings(db.pool, { id: driver, role: 'driver' }, undefined, range)).rejects.toMatchObject({
    code: 'INVALID_DATE_RANGE',
  });
});
test('a cursor outside the selected period cannot be reused', async () => {
  await entry();
  const latest = await read();
  await expect(
    getEarnings(db.pool, { id: driver, role: 'driver' }, latest.entries[0]!.id, {
      from: '2026-10-01',
      through: '2026-10-31',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
});

test('filtered pagination keeps the complete period total across pages with tied timestamps', async () => {
  for (let index = 0; index < 52; index++) await entry(driver, 10);
  await entry(driver, 100, 'allocation', '2026-08-31T23:59:59Z');
  const actor = { id: driver, role: 'driver' as const };
  const range = { from: '2026-09-01', through: '2026-09-30' };
  const first = await getEarnings(db.pool, actor, undefined, range);
  const second = await getEarnings(db.pool, actor, first.nextCursor!, range);
  expect(first.entries).toHaveLength(50);
  expect(second.entries).toHaveLength(2);
  expect(second.nextCursor).toBeNull();
  for (const page of [first, second]) {
    expect(page.recordedTotal.amount).toBe(620);
    expect(page.periodTotal?.amount).toBe(520);
  }
  expect(new Set([...first.entries, ...second.entries].map((row) => row.id)).size).toBe(52);
});
