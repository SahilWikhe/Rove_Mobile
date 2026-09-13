import { bindRideRead } from './ride-scope';
import type { PoolClient } from 'pg';
import { z } from 'zod';

const sourceSchema = z.string().regex(/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/);
const referenceSchema = z.union([
  z.object({ intentId: z.string().regex(/^pi_[a-zA-Z0-9]{1,96}$/) }).strict(),
  z.object({ rideId: z.uuid() }).strict(),
  z.object({ attemptId: z.uuid() }).strict(),
]);
export type PaymentAttemptReference = z.infer<typeof referenceSchema>;

/** Exact backend lookup within the caller's transaction; provider metadata cannot select an owner. */
export async function bindPaymentAttemptRead(
  client: PoolClient,
  source: string,
  reference: PaymentAttemptReference,
) {
  const selected = referenceSchema.parse(reference);
  await client.query(
    "SELECT set_config('rove.payment_attempt_read',$1,true),set_config('rove.payment_attempt_write','',true),set_config('rove.payment_attempt_scan','',true),set_config('rove.payment_attempt_lock','',true),set_config('rove.payment_attempt_closure','',true)",
    [JSON.stringify({ source: sourceSchema.parse(source), ...selected })],
  );
  const column = 'rideId' in selected ? 'ride_id' : 'attemptId' in selected ? 'id' : 'intent_id';
  const value =
    'rideId' in selected ? selected.rideId : 'attemptId' in selected ? selected.attemptId : selected.intentId;
  await client.query(
    `SELECT set_config('rove.ride_read',COALESCE((SELECT ride_id::text FROM payment_attempts WHERE source=$1 AND ${column}=$2),''),true),set_config('rove.ride_write','',true),set_config('rove.ride_batch','',true),set_config('rove.ride_expiry_before','',true),set_config('rove.ride_create','',true)`,
    [source, value],
  );
}

const writeSchema = z
  .object({
    attemptId: z.uuid(),
    rideId: z.uuid(),
    bindingId: z.uuid(),
    source: sourceSchema,
    amountCents: z.number().int().min(50).max(99999999),
    intentId: z.string().regex(/^pi_[a-zA-Z0-9]{1,96}$/),
  })
  .strict();

/** Verified provider results only. Immutable local identifiers/amount are taken from the persisted attempt. */
export async function bindPaymentAttemptWrite(client: PoolClient, input: z.infer<typeof writeSchema>) {
  const selected = writeSchema.parse(input);
  await bindPaymentAttemptRead(client, selected.source, { attemptId: selected.attemptId });
  await client.query("SELECT set_config('rove.payment_attempt_write',$1,true)", [JSON.stringify(selected)]);
}

/** Source-wide read-only access for trusted recovery scans and durable operation lookups. */
export async function bindPaymentAttemptScan(client: PoolClient, source: string) {
  sourceSchema.parse(source);
  await client.query(
    "SELECT set_config('rove.payment_attempt_scan',$1,true),set_config('rove.payment_attempt_read','',true),set_config('rove.payment_attempt_write','',true),set_config('rove.payment_attempt_lock','',true),set_config('rove.payment_attempt_closure','',true)",
    [source],
  );
}
/** Exact payment lock for already-validated accounting operations. */
export async function bindPaymentAttemptLock(client: PoolClient, attemptId: string) {
  z.uuid().parse(attemptId);
  await client.query("SELECT set_config('rove.payment_attempt_lock',$1,true)", [attemptId]);
}

/** A queued ride event must detect a mismatched provider before dispatching any external work. */
export async function bindPaymentAttemptRideEvent(client: PoolClient, rideId: string) {
  z.uuid().parse(rideId);
  await client.query(
    "SELECT set_config('rove.payment_attempt_read',$1,true),set_config('rove.payment_attempt_write','',true),set_config('rove.payment_attempt_scan','',true),set_config('rove.payment_attempt_lock','',true),set_config('rove.payment_attempt_closure','',true)",
    [JSON.stringify({ kind: 'ride-event', rideId })],
  );
  await bindRideRead(client, rideId);
}
