import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, test, expect } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { MessagingService } from './messaging';
import { PushAudience } from './push-audience';
import type { Actor } from './rides';
let db: Awaited<ReturnType<typeof testDatabase>>, service: MessagingService;
let rider: Actor, driver: Actor, outsider: Actor, offer: string, ride: string;
beforeAll(async () => {
  db = await testDatabase();
  service = new MessagingService(db.pool);
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  await db.pool.query('TRUNCATE outbox CASCADE');
  rider = { id: randomUUID(), role: 'rider' };
  driver = { id: randomUUID(), role: 'driver' };
  outsider = { id: randomUUID(), role: 'driver' };
  for (const a of [rider, driver, outsider])
    await db.pool.query('INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,$2,$3)', [
      a.id,
      'Synthetic ' + a.role,
      a.role,
    ]);
  for (const a of [driver, outsider]) await db.pool.query('INSERT INTO drivers(id) VALUES($1)', [a.id]);
  const quote = randomUUID();
  ride = randomUUID();
  offer = randomUUID();
  await db.pool.query(
    "INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now()+interval '1 hour')",
    [quote, rider.id],
  );
  await db.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,driver_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,$4,'matched',1000,750,now())",
    [ride, quote, rider.id, driver.id],
  );
  await db.pool.query(
    "INSERT INTO offers(id,ride_id,driver_id,status,expires_at,snapshot) VALUES($1,$2,$3,'accepted',now(),'{}')",
    [offer, ride, driver.id],
  );
});
const input = (text = 'I am at the front entrance') => ({ text, requestId: randomUUID() });
test('both participants exchange real persisted messages; retries and unread acknowledgements are monotonic', async () => {
  const request = input();
  const results = await Promise.all([
    service.send(rider, offer, request),
    service.send(rider, offer, request),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect((await db.pool.query('SELECT id FROM trip_messages')).rowCount).toBe(1);
  const reply = await service.send(driver, offer, input('I am outside now'));
  const thread = await service.thread(driver, offer);
  expect(thread.messages.map((m) => m.mine)).toEqual([false, true]);
  expect(thread.conversation.unread).toBe(1);
  await service.read(driver, offer, { through: reply.sequence });
  await service.read(driver, offer, { through: results[0]!.sequence });
  expect((await service.thread(driver, offer)).conversation.unread).toBe(0);
  expect((await service.list(rider)).conversations[0]?.unread).toBe(1);
  await expect(service.send(rider, offer, { ...request, text: 'different' })).rejects.toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  expect((await db.pool.query('SELECT id FROM outbox')).rowCount).toBe(2);
  expect(JSON.stringify((await db.pool.query('SELECT payload FROM outbox')).rows)).not.toContain(
    request.text,
  );
  expect((await db.pool.query('SELECT id FROM commands')).rowCount).toBe(0);
});
test('no access before acceptance, from an outsider, forged role, or disabled account', async () => {
  await expect(service.thread(outsider, offer)).rejects.toMatchObject({ code: 'CONVERSATION_UNAVAILABLE' });
  await expect(service.send({ ...rider, role: 'driver' }, offer, input())).rejects.toThrow();
  expect((await service.list(outsider)).conversations).toEqual([]);
  await db.pool.query("UPDATE offers SET status='pending' WHERE id=$1", [offer]);
  await expect(service.forRide(rider, ride)).rejects.toThrow();
  await expect(service.send(rider, offer, input())).rejects.toThrow();
  await db.pool.query("UPDATE offers SET status='accepted' WHERE id=$1", [offer]);
  const request = input();
  await service.send(rider, offer, request);
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [rider.id]);
  await expect(service.send(rider, offer, request)).rejects.toThrow();
  await expect(service.thread(driver, offer)).rejects.toThrow();
});
test('replacement assignment cannot see or replay the former conversation', async () => {
  const request = input();
  await service.send(driver, offer, request);
  await db.pool.query('UPDATE rides SET driver_id=$2 WHERE id=$1', [ride, outsider.id]);
  for (const actor of [rider, driver, outsider]) await expect(service.thread(actor, offer)).rejects.toThrow();
  await expect(service.send(driver, offer, request)).rejects.toThrow();
  const replacement = randomUUID();
  await db.pool.query(
    "INSERT INTO offers(id,ride_id,driver_id,status,expires_at,snapshot) VALUES($1,$2,$3,'accepted',now(),'{}')",
    [replacement, ride, outsider.id],
  );
  expect((await service.thread(outsider, replacement)).messages).toEqual([]);
});
test('trip completion closes sending and 30-day history excludes expired message text', async () => {
  const sent = await service.send(rider, offer, input());
  await db.pool.query("UPDATE rides SET state='completed',updated_at=now() WHERE id=$1", [ride]);
  expect((await service.thread(driver, offer)).conversation.canSend).toBe(false);
  await expect(service.send(driver, offer, input())).rejects.toMatchObject({ code: 'CONVERSATION_CLOSED' });
  await db.pool.query("UPDATE trip_messages SET created_at=now()-interval '31 days' WHERE id=$1", [sent.id]);
  expect((await service.thread(rider, offer)).messages).toEqual([]);
  await db.pool.query("UPDATE rides SET updated_at=now()-interval '31 days' WHERE id=$1", [ride]);
  await expect(service.thread(rider, offer)).rejects.toThrow();
  expect((await service.list(rider)).conversations).toEqual([]);
});
test('report is idempotent, creates a support request and closes sending for both participants', async () => {
  await Promise.all([
    service.report(rider, offer, { reason: 'harassment' }),
    service.report(rider, offer, { reason: 'harassment' }),
  ]);
  expect((await db.pool.query('SELECT id FROM support_requests')).rowCount).toBe(1);
  for (const actor of [driver, rider]) {
    expect((await service.thread(actor, offer)).conversation.blocked).toBe(true);
    await expect(service.send(actor, offer, input())).rejects.toMatchObject({ code: 'CONVERSATION_CLOSED' });
  }
});
test('concurrent sends obey rate cap, invalid bodies and foreign read receipts cannot persist', async () => {
  const sent = await Promise.allSettled(
    Array.from({ length: 14 }, (_, i) => service.send(rider, offer, input('message ' + i))),
  );
  expect(sent.filter((x) => x.status === 'fulfilled')).toHaveLength(10);
  for (const text of ['', ' ', 'x'.repeat(1001), 'a\u0000b'])
    await expect(service.send(driver, offer, input(text))).rejects.toThrow();
  await expect(service.send(driver, offer, { ...input(), senderId: rider.id })).rejects.toThrow();
  await expect(service.read(driver, offer, { through: 2147483000 })).rejects.toMatchObject({
    code: 'INVALID_READ',
  });
});
test('a racing completion wins its lock before a send and prevents the send', async () => {
  const lock = await db.pool.connect();
  await lock.query('BEGIN');
  await lock.query("UPDATE rides SET state='completed' WHERE id=$1", [ride]);
  const pending = service.send(rider, offer, input());
  await lock.query('COMMIT');
  lock.release();
  await expect(pending).rejects.toMatchObject({ code: 'CONVERSATION_CLOSED' });
});
test('failed outbox insert rolls back message and permits the same retry', async () => {
  const request = input();
  await db.pool.query("ALTER TABLE outbox ADD CONSTRAINT message_fixture CHECK(topic<>'message.created')");
  try {
    await expect(service.send(rider, offer, request)).rejects.toThrow();
  } finally {
    await db.pool.query('ALTER TABLE outbox DROP CONSTRAINT message_fixture');
  }
  expect((await db.pool.query('SELECT id FROM trip_messages')).rowCount).toBe(0);
  await expect(service.send(rider, offer, request)).resolves.toMatchObject({ text: request.text });
});
test('message push has no text/identity, targets only recipient and suppresses after read or revocation', async () => {
  const project = randomUUID(),
    installation = randomUUID();
  await db.pool.query(
    "INSERT INTO push_installations(id,project_id,installation_id,secret_hash,owner_id,token,platform) VALUES($1,$2,$3,'hash',$4,'ExpoPushToken[synthetic]','ios')",
    [installation, project, randomUUID(), driver.id],
  );
  const sent = await service.send(rider, offer, input());
  const event = (await db.pool.query('SELECT id FROM outbox WHERE aggregate_id=$1', [sent.id])).rows[0].id;
  const audience = new PushAudience(db.pool, { driver: project });
  const recipients = await audience.recipients(event);
  expect(recipients).toHaveLength(1);
  const push = await audience.message(recipients[0]!);
  expect(push?.hint).toMatchObject({ kind: 'message_available', referenceId: offer });
  expect(JSON.stringify(push)).not.toContain(sent.text);
  await service.read(driver, offer, { through: sent.sequence });
  expect(await audience.message(recipients[0]!)).toBeNull();
  await service.send(rider, offer, input('Second message'));
  const event2 = (await db.pool.query('SELECT id FROM outbox ORDER BY created_at DESC LIMIT 1')).rows[0].id;
  const next = (await audience.recipients(event2))[0]!;
  await db.pool.query('UPDATE rides SET driver_id=$2 WHERE id=$1', [ride, outsider.id]);
  expect(await audience.message(next)).toBeNull();
});
