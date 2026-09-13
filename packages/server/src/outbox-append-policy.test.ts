import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createDatabase } from '@rove/database';
import { testDatabase } from '@rove/database/testing';
import { transaction } from './transactions';
import { enqueueOutbox } from './outbox-enqueue';
let db: Awaited<ReturnType<typeof testDatabase>>;
let runtime: ReturnType<typeof createDatabase>;
beforeAll(async () => {
  db = await testDatabase();
  const password = randomBytes(32).toString('hex');
  await db.pool.query(`CREATE ROLE outbox_append_probe LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
  await db.pool.query('GRANT USAGE ON SCHEMA public TO outbox_append_probe');
  await db.pool.query(
    'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO outbox_append_probe',
  );
  const connection = new URL(db.connectionString);
  connection.username = 'outbox_append_probe';
  connection.password = password;
  runtime = createDatabase(connection.toString());
}, 60000);
afterAll(async () => {
  await runtime?.close();
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE outbox CASCADE');
});
const input = () => ({
  topic: 'synthetic.event',
  aggregateId: randomUUID(),
  payload: '{"version":1}',
  dedupeKey: randomUUID(),
});
test('scoped appends preserve scheduling and retry deduplication without read access', async () => {
  const job = { ...input(), availableAt: new Date(Date.now() + 60000), ignoreDuplicate: true };
  const results = await Promise.all(
    Array.from({ length: 4 }, () => transaction(runtime.pool, (c) => enqueueOutbox(c, job))),
  );
  expect(results.reduce((n, r) => n + (r.rowCount ?? 0), 0)).toBe(1);
  const row = (await db.pool.query('SELECT * FROM outbox')).rows[0];
  expect(row.available_at).toEqual(job.availableAt);
  expect(row.payload).toEqual({ version: 1 });
  expect(row.attempts).toBe(0);
  expect((await runtime.pool.query('SELECT * FROM outbox')).rowCount).toBe(0);
  await transaction(runtime.pool, async (c) => {
    await c.query("SELECT set_config('rove.outbox_append',$1,true)", [JSON.stringify({ key: randomUUID() })]);
    expect((await c.query('SELECT * FROM outbox')).rowCount).toBe(0);
    await c.query("SELECT set_config('rove.outbox_append',$1,true)", [
      JSON.stringify({ key: job.dedupeKey }),
    ]);
    expect((await c.query('SELECT dedupe_key FROM outbox')).rows).toEqual([{ dedupe_key: job.dedupeKey }]);
  });
  await transaction(runtime.pool, async (c) => {
    await enqueueOutbox(c, input());
    expect((await c.query("SELECT current_setting('rove.outbox_append',true) AS scope")).rows[0].scope).toBe(
      '',
    );
    expect((await c.query('UPDATE outbox SET completed_at=now()')).rowCount).toBe(0);
    expect((await c.query('DELETE FROM outbox')).rowCount).toBe(0);
  });
});
test('failed transactions leave no job and strict duplicates still fail', async () => {
  const job = input();
  await expect(
    transaction(runtime.pool, async (c) => {
      await enqueueOutbox(c, job);
      throw Error('synthetic rollback');
    }),
  ).rejects.toThrow('synthetic rollback');
  expect((await db.pool.query('SELECT * FROM outbox')).rowCount).toBe(0);
  await transaction(runtime.pool, (c) => enqueueOutbox(c, job));
  await expect(transaction(runtime.pool, (c) => enqueueOutbox(c, job))).rejects.toMatchObject({
    code: 'CONFLICT',
  });
});
test('unscoped and forged fields cannot enqueue work or preset worker state', async () => {
  await expect(
    transaction(runtime.pool, (c) =>
      c.query("INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES('synthetic',$1,'{}',$2)", [
        randomUUID(),
        randomUUID(),
      ]),
    ),
  ).rejects.toMatchObject({ code: '42501' });
  for (const mutation of [
    "topic='forged'",
    'attempts=1',
    "available_at=now()+interval '1 hour'",
    'completed_at=now()',
  ]) {
    const id = randomUUID(),
      aggregate = randomUUID(),
      key = randomUUID();
    await expect(
      transaction(runtime.pool, async (c) => {
        await c.query("SELECT set_config('rove.outbox_append',$1,true)", [
          JSON.stringify({ id, topic: 'synthetic', aggregate, payload: {}, key, available: null }),
        ]);
        const [column, value] = mutation.split('=');
        const columns = ['id', 'topic', 'aggregate_id', 'payload', 'dedupe_key'];
        const values = ['$1', "'synthetic'", '$2', "'{}'", '$3'];
        const index = columns.indexOf(column!);
        if (index >= 0) values[index] = value!;
        else {
          columns.push(column!);
          values.push(value!);
        }
        await c.query(`INSERT INTO outbox(${columns.join(',')}) VALUES(${values.join(',')})`, [
          id,
          aggregate,
          key,
        ]);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  }
});
