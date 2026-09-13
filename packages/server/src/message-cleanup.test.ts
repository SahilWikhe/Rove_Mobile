import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, test, expect } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { MessagingService } from './messaging';
import { MessageCleanup } from './message-cleanup';
import type { Actor } from './rides';
let db: Awaited<ReturnType<typeof testDatabase>>, service: MessagingService;
let rider: Actor, driver: Actor, outsider: Actor, offer: string, ride: string;
let staff: Actor, requestId: string, messageId: string, cleanup: MessageCleanup;
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
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  cleanup = new MessageCleanup(db.pool, 'synthetic-policy');
  rider = { id: randomUUID(), role: 'rider' };
  driver = { id: randomUUID(), role: 'driver' };
  outsider = { id: randomUUID(), role: 'driver' };
  for (const a of [rider, driver, outsider, staff])
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

  await db.pool.query("INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.cleanup')", [
    staff.id,
  ]);
  messageId = (await service.send(rider, offer, { text: 'Synthetic private text', requestId: randomUUID() }))
    .id;
  await service.send(driver, offer, { text: 'Counterpart retained text', requestId: randomUUID() });
  await db.pool.query("UPDATE trip_messages SET created_at=now()-interval '40 days'");
  await db.pool.query("UPDATE rides SET state='completed' WHERE id=$1", [ride]);
  const support = (
    await db.pool.query(
      "INSERT INTO support_requests(owner_id,category,message) VALUES($1,'account','Synthetic closure') RETURNING id",
      [rider.id],
    )
  ).rows[0].id;
  requestId = (
    await db.pool.query(
      "INSERT INTO account_deletion_requests(owner_id,support_request_id,consent_version) VALUES($1,$2,'account-deletion-v1') RETURNING id",
      [rider.id, support],
    )
  ).rows[0].id;
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [rider.id]);
  await db.pool.query(
    "INSERT INTO account_closures(request_id,owner_id,authorized_by,policy_reference,review_reference) VALUES($1,$2,$3,'synthetic-policy','synthetic-review')",
    [requestId, rider.id, staff.id],
  );
});
const batch = () => ({
  policyReference: 'synthetic-policy',
  reviewReference: 'synthetic-review',
  createdBefore: new Date(Date.now() - 35 * 86400000).toISOString(),
  messageIds: [messageId],
});

test('reviewed deletion removes only authored targets, audits without bodies and replays once', async () => {
  const input = batch(),
    key = randomUUID();
  const results = await Promise.all([
    cleanup.erase(staff, requestId, input, key),
    cleanup.erase(staff, requestId, input, key),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({ removedMessages: 1, completeErasureVerified: false });
  expect((await db.pool.query('SELECT text FROM trip_messages')).rows).toEqual([
    { text: 'Counterpart retained text' },
  ]);
  const audits = await db.pool.query(
    "SELECT metadata FROM audit WHERE action='account_deletion.messages_erased'",
  );
  expect(audits.rowCount).toBe(1);
  expect(JSON.stringify(audits.rows)).not.toContain('Synthetic private text');
  await db.pool.query('DELETE FROM staff_permissions WHERE staff_id=$1', [staff.id]);
  await expect(cleanup.erase(staff, requestId, input, key)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('disabled policy, missing MFA, open account and mixed ownership refuse the entire batch', async () => {
  await expect(
    new MessageCleanup(db.pool).erase(staff, requestId, batch(), randomUUID()),
  ).rejects.toMatchObject({ code: 'CLEANUP_DISABLED' });
  await expect(
    cleanup.erase({ ...staff, mfa: false }, requestId, batch(), randomUUID()),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const other = (await db.pool.query('SELECT id FROM trip_messages WHERE sender_id=$1', [driver.id])).rows[0]
    .id;
  await expect(
    cleanup.erase(staff, requestId, { ...batch(), messageIds: [messageId, other] }, randomUUID()),
  ).rejects.toMatchObject({ code: 'CLEANUP_SCOPE' });
  const ticket = (
    await db.pool.query(
      "INSERT INTO support_requests(owner_id,category,message) VALUES($1,'account','Synthetic open request') RETURNING id",
      [driver.id],
    )
  ).rows[0].id;
  const openRequest = (
    await db.pool.query(
      "INSERT INTO account_deletion_requests(owner_id,support_request_id,consent_version) VALUES($1,$2,'account-deletion-v1') RETURNING id",
      [driver.id, ticket],
    )
  ).rows[0].id;
  await expect(
    cleanup.erase(staff, openRequest, { ...batch(), messageIds: [other] }, randomUUID()),
  ).rejects.toMatchObject({ code: 'CLEANUP_NOT_CLOSED' });
  expect((await db.pool.query('SELECT id FROM trip_messages')).rowCount).toBe(2);
});

test('recent messages, active trips and reported conversations remain retained', async () => {
  await db.pool.query('UPDATE trip_messages SET created_at=now() WHERE id=$1', [messageId]);
  await expect(cleanup.erase(staff, requestId, batch(), randomUUID())).rejects.toMatchObject({
    code: 'CLEANUP_RETAINED',
  });
  await db.pool.query("UPDATE trip_messages SET created_at=now()-interval '40 days' WHERE id=$1", [
    messageId,
  ]);
  await expect(db.pool.query("UPDATE rides SET state='in_progress' WHERE id=$1", [ride])).rejects.toThrow(
    'Active ride requires active rider',
  );
  await db.pool.query(
    'INSERT INTO trip_message_reports(offer_id,reporter_id,support_id) SELECT $1,$2,support_request_id FROM account_deletion_requests WHERE id=$3',
    [offer, driver.id, requestId],
  );
  await expect(cleanup.erase(staff, requestId, batch(), randomUUID())).rejects.toMatchObject({
    code: 'CLEANUP_RETAINED',
  });
  expect((await db.pool.query('SELECT id FROM trip_messages')).rowCount).toBe(2);
});

test('counterpart holds protect messages even when review time is past', async () => {
  await db.pool.query(
    "INSERT INTO retention_holds(owner_id,kind,reason_reference,review_at,placed_by) VALUES($1,'safety','synthetic',now()-interval '1 day',$2)",
    [driver.id, staff.id],
  );
  await expect(cleanup.erase(staff, requestId, batch(), randomUUID())).rejects.toMatchObject({
    code: 'RETENTION_HOLD',
  });
  expect((await db.pool.query('SELECT id FROM trip_messages')).rowCount).toBe(2);
});

test('audit failure rolls back deletion and command receipt', async () => {
  await db.pool.query(
    `CREATE FUNCTION reject_cleanup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='account_deletion.messages_erased' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.pool.query(
    'CREATE TRIGGER reject_cleanup_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_cleanup_audit()',
  );
  try {
    await expect(cleanup.erase(staff, requestId, batch(), randomUUID())).rejects.toThrow();
    expect((await db.pool.query('SELECT id FROM trip_messages')).rowCount).toBe(2);
    expect((await db.pool.query('SELECT key FROM commands WHERE actor_id=$1', [staff.id])).rowCount).toBe(0);
  } finally {
    await db.pool.query('DROP TRIGGER reject_cleanup_audit ON audit');
    await db.pool.query('DROP FUNCTION reject_cleanup_audit()');
  }
});

test('a hold committed while cleanup waits on the participant lock prevents deletion', async () => {
  const holder = await db.pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [driver.id]);
    const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending = cleanup.erase(staff, requestId, batch(), randomUUID()).catch((error: unknown) => error);
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await db.pool.query(
        'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',
        [pid],
      );
      if (result.rows[0].waiting) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await holder.query(
      "INSERT INTO retention_holds(owner_id,kind,reason_reference,review_at,placed_by) VALUES($1,'legal','synthetic-race',now()+interval '1 day',$2)",
      [driver.id, staff.id],
    );
    await holder.query('COMMIT');
    expect(await pending).toMatchObject({ code: 'RETENTION_HOLD' });
    expect((await db.pool.query('SELECT id FROM trip_messages')).rowCount).toBe(2);
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
    await pending;
  }
});
