import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, test, expect } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { PaymentReviews } from './payment-review';
import { OutboxWorker, type Job } from './outbox';
import { actorTransaction } from './actor-transaction';
let db: Awaited<ReturnType<typeof testDatabase>>, pool: Pool, reviews: PaymentReviews, job: Job;
let staff: { id: string; role: 'staff'; mfa: true }, rider: string;
beforeAll(async () => {
  db = await testDatabase();
  await db.pool.query(
    "CREATE ROLE review_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'synthetic-local-only'",
  );
  await db.pool.query('GRANT USAGE ON SCHEMA public TO review_runtime');
  await db.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO review_runtime');
  pool = new Pool({
    host: '127.0.0.1',
    port: (await db.pool.query('SELECT inet_server_port() AS port')).rows[0].port,
    database: 'postgres',
    user: 'review_runtime',
    password: 'synthetic-local-only',
    max: 3,
  });
  reviews = new PaymentReviews(pool, 'acct_fixture:test');
}, 60000);
afterAll(async () => {
  await pool?.end();
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users,outbox,audit CASCADE');
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  rider = randomUUID();
  const quote = randomUUID(),
    ride = randomUUID(),
    binding = randomUUID(),
    attempt = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Synthetic staff','staff'),($2::uuid,$2::text,'Synthetic rider','rider')",
    [staff.id, rider],
  );
  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'payments.review')", [
    staff.id,
  ]);
  await db.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
    quote,
    rider,
  ]);
  await db.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,state,fare_cents,earnings_cents,search_deadline,payment_state) VALUES($1,$2,$3,'cancelled',200,150,now(),'released')",
    [ride, quote, rider],
  );
  await db.pool.query(
    "INSERT INTO payment_customers(id,rider_id,source,customer_id) VALUES($1,$2,'acct_fixture:test','cus_fixture')",
    [binding, rider],
  );
  await db.pool.query(
    "INSERT INTO payment_attempts(id,ride_id,customer_binding_id,source,amount_cents,intent_id) VALUES($1,$2,$3,'acct_fixture:test',200,'pi_fixture')",
    [attempt, ride, binding],
  );
  job = {
    id: randomUUID(),
    topic: 'payment.review_required',
    aggregateId: ride,
    payload: { attemptId: attempt },
    attempt: 1,
  };
  await db.pool.query(
    'INSERT INTO outbox(id,topic,aggregate_id,payload,dedupe_key) VALUES($1::uuid,$2,$3,$4,$1::text)',
    [job.id, job.topic, ride, JSON.stringify(job.payload)],
  );
});
test('persisted late escalation survives terminal payment, concurrent retries and worker acknowledgment', async () => {
  await Promise.all([reviews.handle(job), reviews.handle(job)]);
  const worker = new OutboxWorker(pool, { 'payment.review_required': reviews.handle });
  expect(await worker.runOnce()).toEqual({ processed: 1, failed: 0 });
  expect((await db.pool.query('SELECT * FROM payment_review_cases')).rowCount).toBe(1);
  expect((await db.pool.query("SELECT * FROM audit WHERE action='payment.review_opened'")).rowCount).toBe(1);
  expect((await reviews.queue(staff, {})).items).toHaveLength(1);
  expect((await pool.query('SELECT * FROM payment_review_cases')).rowCount).toBe(0);
  expect((await db.pool.query('SELECT payment_state FROM rides')).rows[0].payment_state).toBe('released');
});
test('rejects missing event, mismatched aggregate and configured source', async () => {
  await expect(reviews.handle({ ...job, id: randomUUID() })).rejects.toMatchObject({
    code: 'PAYMENT_REVIEW_EVENT',
  });
  await expect(reviews.handle({ ...job, aggregateId: randomUUID() })).rejects.toMatchObject({
    code: 'PAYMENT_REVIEW_EVENT',
  });
  await expect(new PaymentReviews(pool, 'acct_other:test').handle(job)).rejects.toMatchObject({
    code: 'PAYMENT_REVIEW_EVENT',
  });
  expect((await db.pool.query('SELECT * FROM payment_review_cases')).rowCount).toBe(0);
});
test('MFA/current permission required; acknowledgment is audited and retry safe without money movement', async () => {
  await reviews.handle(job);
  await expect(reviews.queue({ ...staff, mfa: false }, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(reviews.queue({ id: rider, role: 'rider' }, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const first = await reviews.acknowledge(staff, job.id, { reference: 'support:fixture-1' });
  expect(await reviews.acknowledge(staff, job.id, { reference: 'support:fixture-1' })).toEqual(first);
  expect((await reviews.queue(staff, {})).items).toHaveLength(0);
  expect((await reviews.queue(staff, { includeAcknowledged: 'true' })).items).toHaveLength(1);
  await expect(reviews.acknowledge(staff, job.id, { reference: 'support:other' })).rejects.toMatchObject({
    code: 'REVIEW_ACKNOWLEDGED',
  });
  await actorTransaction(pool, staff, async (c) => {
    await expect(c.query("UPDATE payment_review_cases SET source='acct_other:test'")).rejects.toMatchObject({
      code: '42501',
    });
  });
  expect((await db.pool.query('SELECT * FROM ledger_journals')).rowCount).toBe(0);
  await db.pool.query('DELETE FROM staff_permissions WHERE staff_id=$1', [staff.id]);
  await expect(reviews.acknowledge(staff, job.id, { reference: 'support:fixture-1' })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
test('runtime cannot invent or erase cases and new events remain visible after earlier acknowledgment', async () => {
  await expect(
    pool.query('INSERT INTO payment_review_cases(id,ride_id,attempt_id,source) VALUES($1,$2,$3,$4)', [
      job.id,
      job.aggregateId,
      (job.payload as { attemptId: string }).attemptId,
      'acct_fixture:test',
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  await reviews.handle(job);
  await reviews.acknowledge(staff, job.id, { reference: 'support:case-1' });
  const next = { ...job, id: randomUUID() };
  await db.pool.query(
    'INSERT INTO outbox(id,topic,aggregate_id,payload,dedupe_key) VALUES($1::uuid,$2,$3,$4,$1::text)',
    [next.id, next.topic, next.aggregateId, JSON.stringify(next.payload)],
  );
  await reviews.handle(next);
  expect((await reviews.queue(staff, {})).items.map((i) => i.id)).toEqual([next.id]);
  await actorTransaction(pool, staff, async (c) =>
    expect((await c.query('DELETE FROM payment_review_cases')).rowCount).toBe(0),
  );
});

test('bounded queue pagination has no duplicate rows and disabled staff cannot read', async () => {
  await reviews.handle(job);
  const input = job.payload as { attemptId: string };
  for (let i = 0; i < 50; i++)
    await db.pool.query(
      'INSERT INTO payment_review_cases(id,ride_id,attempt_id,source) VALUES($1,$2,$3,$4)',
      [randomUUID(), job.aggregateId, input.attemptId, 'acct_fixture:test'],
    );
  const first = await reviews.queue(staff, {});
  expect(first.items).toHaveLength(50);
  expect(first.nextCursor).not.toBeNull();
  const second = await reviews.queue(staff, { after: first.nextCursor });
  expect(second.items).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(51);
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [staff.id]);
  await expect(reviews.queue(staff, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
test('case table forces RLS and actor binding clears inherited intake scope', async () => {
  await reviews.handle(job);
  const policy = (
    await db.pool.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='payment_review_cases'::regclass",
    )
  ).rows[0];
  expect(policy).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  await actorTransaction(pool, { id: rider, role: 'rider' }, async (c) => {
    await c.query("SELECT set_config('rove.payment_review_intake',$1,true)", [
      JSON.stringify({ id: job.id }),
    ]);
    const { bindActorIdentity } = await import('./actor-transaction');
    await bindActorIdentity(c, { id: rider, role: 'rider' });
    expect((await c.query('SELECT * FROM payment_review_cases')).rowCount).toBe(0);
  });
});

test('staff recovery retains the original dead letter and is audited once across retries', async () => {
  await db.pool.query("UPDATE outbox SET dead_letter_at=now(),last_error_code='UNKNOWN_TOPIC' WHERE id=$1", [
    job.id,
  ]);
  await expect(reviews.recover({ id: rider, role: 'rider' }, job.id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect(await reviews.recover(staff, job.id)).toEqual({ id: job.id });
  expect(await reviews.recover(staff, job.id)).toEqual({ id: job.id });
  expect((await db.pool.query('SELECT * FROM payment_review_cases')).rowCount).toBe(1);
  expect(
    (await db.pool.query("SELECT actor_id FROM audit WHERE action='payment.review_recovered'")).rows,
  ).toEqual([{ actor_id: staff.id }]);
  const original = (
    await db.pool.query('SELECT dead_letter_at,completed_at,last_error_code FROM outbox WHERE id=$1', [
      job.id,
    ])
  ).rows[0];
  expect(original.dead_letter_at).not.toBeNull();
  expect(original.completed_at).toBeNull();
  expect(original.last_error_code).toBe('UNKNOWN_TOPIC');
  expect((await db.pool.query('SELECT * FROM ledger_journals')).rowCount).toBe(0);
  await db.pool.query('DELETE FROM staff_permissions WHERE staff_id=$1', [staff.id]);
  await expect(reviews.recover(staff, job.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
