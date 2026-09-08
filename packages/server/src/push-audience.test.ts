import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { PushAudience } from './push-audience';
import { PushInstallations } from './push-installations';
let db: Awaited<ReturnType<typeof testDatabase>>;
let audience: PushAudience;
let now: Date;
let rider: string, driver: string, outsider: string, ride: string, eventId: string;
const projects = { rider: randomUUID(), driver: randomUUID() };
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  await db.pool.query('TRUNCATE outbox CASCADE');
  now = new Date();
  rider = randomUUID();
  driver = randomUUID();
  outsider = randomUUID();
  ride = randomUUID();
  eventId = randomUUID();
  for (const [id, role] of [
    [rider, 'rider'],
    [driver, 'driver'],
    [outsider, 'rider'],
  ]) {
    await db.pool.query("INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Synthetic',$2)", [
      id,
      role,
    ]);
  }
  await db.pool.query(
    `INSERT INTO drivers(id,approved,online,payout_ready,payout_valid_until,eligibility_expires_at,location_at)
    VALUES($1,true,true,true,$2::timestamptz+interval '1 hour',$2::timestamptz+interval '1 day',$2)`,
    [driver, now],
  );
  const quote = randomUUID();
  await db.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',$3)", [
    quote,
    rider,
    now,
  ]);
  await db.pool.query(
    `INSERT INTO rides(id,quote_id,rider_id,driver_id,state,payment_state,fare_cents,earnings_cents,search_deadline)
    VALUES($1,$2,$3,$4,'matched','authorized',1000,750,$5::timestamptz+interval '3 minutes')`,
    [ride, quote, rider, driver, now],
  );
  await db.pool.query(
    `INSERT INTO outbox(id,topic,aggregate_id,payload,dedupe_key,created_at)
    VALUES($1::uuid,'ride.matched',$2,'{}',$1::text,$3)`,
    [eventId, ride, now],
  );
  const registrations = new PushInstallations(db.pool, projects);
  for (const [id, role] of [
    [rider, 'rider'],
    [driver, 'driver'],
    [outsider, 'rider'],
  ] as const) {
    await registrations.register(
      { id, role },
      {
        installationId: randomUUID(),
        secret: randomBytes(32).toString('base64url'),
        mutationId: randomUUID(),
        expectedRevision: null,
        token: `ExpoPushToken[${randomUUID()}]`,
        platform: 'ios',
      },
    );
  }
  audience = new PushAudience(db.pool, projects, () => now);
});
test('selects current ride participants only, with no token or personal data in queued references', async () => {
  const recipients = await audience.recipients(eventId);
  expect(recipients).toHaveLength(2);
  for (const recipient of recipients) {
    expect(Object.keys(recipient).sort()).toEqual(['eventId', 'installationId', 'revision']);
    const message = await audience.message(recipient);
    expect(message?.hint).toEqual({ eventId, kind: 'ride_update', referenceId: ride });
    expect(Object.keys(message!).sort()).toEqual(['expiresAt', 'hint', 'token']);
  }
});
test('rechecks registration revision, logout and disabled accounts before resolving tokens', async () => {
  const recipients = await audience.recipients(eventId);
  await db.pool.query('UPDATE push_installations SET revision=revision+1 WHERE id=$1', [
    recipients[0]!.installationId,
  ]);
  expect(await audience.message(recipients[0]!)).toBeNull();
  await db.pool.query('UPDATE users SET disabled=true WHERE id IN ($1,$2)', [rider, driver]);
  expect(await audience.message(recipients[1]!)).toBeNull();
  expect(await audience.recipients(eventId)).toEqual([]);
  await db.pool.query('UPDATE users SET disabled=false');
  await db.pool.query('UPDATE push_installations SET enabled=false');
  expect(await audience.recipients(eventId)).toEqual([]);
});
test('account transfers, incorrect projects and old registrations cannot receive queued work', async () => {
  const recipients = await audience.recipients(eventId);
  await db.pool.query('UPDATE push_installations SET owner_id=$1 WHERE id=$2', [
    outsider,
    recipients[0]!.installationId,
  ]);
  expect(await audience.message(recipients[0]!)).toBeNull();
  await db.pool.query('UPDATE push_installations SET project_id=$1 WHERE id=$2', [
    randomUUID(),
    recipients[1]!.installationId,
  ]);
  expect(await audience.message(recipients[1]!)).toBeNull();
  await db.pool.query("UPDATE push_installations SET updated_at=$1::timestamptz-interval '30 days'", [now]);
  expect(await audience.recipients(eventId)).toEqual([]);
});
test('ignores unknown or missing events and expires historical notifications at five minutes', async () => {
  expect(await audience.recipients(randomUUID())).toEqual([]);
  await db.pool.query("UPDATE outbox SET topic='payment.capture' WHERE id=$1", [eventId]);
  expect(await audience.recipients(eventId)).toEqual([]);
  await db.pool.query("UPDATE outbox SET topic='ride.matched' WHERE id=$1", [eventId]);
  const recipient = (await audience.recipients(eventId))[0]!;
  now = new Date(now.getTime() + 300000);
  expect(await audience.message(recipient)).toBeNull();
});
async function offerEvent() {
  const offerId = randomUUID();
  await db.pool.query("UPDATE rides SET state='searching',driver_id=NULL WHERE id=$1", [ride]);
  await db.pool.query(
    "INSERT INTO offers(id,ride_id,driver_id,snapshot,expires_at) VALUES($1,$2,$3,'{}',$4::timestamptz+interval '20 seconds')",
    [offerId, ride, driver, now],
  );
  await db.pool.query("UPDATE outbox SET topic='offer.created',payload=$2 WHERE id=$1", [
    eventId,
    JSON.stringify({ offerId, driverId: driver }),
  ]);
  return offerId;
}
test('offer recipients come from the live offer and require funding, availability and eligibility', async () => {
  const offerId = await offerEvent();
  const recipients = await audience.recipients(eventId);
  expect(recipients).toHaveLength(1);
  const message = await audience.message(recipients[0]!);
  expect(message?.hint).toEqual({ eventId, kind: 'offer_available', referenceId: offerId });
  expect(message?.expiresAt).toBe(new Date(now.getTime() + 20000).toISOString());
  for (const column of ['online', 'approved', 'payout_ready']) {
    await db.pool.query(`UPDATE drivers SET ${column}=false WHERE id=$1`, [driver]);
    expect(await audience.message(recipients[0]!)).toBeNull();
    await db.pool.query(`UPDATE drivers SET ${column}=true WHERE id=$1`, [driver]);
  }
  await db.pool.query("UPDATE rides SET payment_state='pending' WHERE id=$1", [ride]);
  expect(await audience.recipients(eventId)).toEqual([]);
});
test('revoked, expired, or payload-mismatched offers cannot be resurrected', async () => {
  const offerId = await offerEvent();
  const recipient = (await audience.recipients(eventId))[0]!;
  await db.pool.query("UPDATE offers SET status='revoked' WHERE id=$1", [offerId]);
  expect(await audience.message(recipient)).toBeNull();
  await db.pool.query("UPDATE offers SET status='pending' WHERE id=$1", [offerId]);
  await db.pool.query('UPDATE outbox SET payload=$2 WHERE id=$1', [
    eventId,
    JSON.stringify({ offerId, driverId: outsider }),
  ]);
  expect(await audience.message(recipient)).toBeNull();
  await db.pool.query('UPDATE outbox SET payload=$2 WHERE id=$1', [
    eventId,
    JSON.stringify({ offerId, driverId: driver }),
  ]);
  now = new Date(now.getTime() + 20000);
  expect(await audience.message(recipient)).toBeNull();
});

test('registration lifetime independently suppresses devices that have not renewed in thirty days', async () => {
  const recipients = await audience.recipients(eventId);
  expect(recipients).toHaveLength(2);
  await db.pool.query("UPDATE push_installations SET updated_at=$1::timestamptz-interval '30 days'", [now]);
  expect(await audience.recipients(eventId)).toEqual([]);
  expect(await audience.message(recipients[0]!)).toBeNull();
  await db.pool.query('UPDATE push_installations SET updated_at=$1', [now]);
  expect(await audience.recipients(eventId)).toHaveLength(2);
});
test('offer delivery checks current location, payout and eligibility deadlines and the ride search deadline', async () => {
  await offerEvent();
  const recipient = (await audience.recipients(eventId))[0]!;
  for (const column of ['payout_valid_until', 'eligibility_expires_at', 'location_at']) {
    await db.pool.query(`UPDATE drivers SET ${column}=$2::timestamptz-interval '1 minute' WHERE id=$1`, [
      driver,
      now,
    ]);
    expect(await audience.message(recipient)).toBeNull();
    await db.pool.query(`UPDATE drivers SET ${column}=$2::timestamptz+interval '1 minute' WHERE id=$1`, [
      driver,
      now,
    ]);
  }
  await db.pool.query('UPDATE rides SET search_deadline=$2 WHERE id=$1', [ride, now]);
  expect(await audience.message(recipient)).toBeNull();
});
