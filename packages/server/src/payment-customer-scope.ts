import { bindPaymentAttemptRead } from './payment-attempt-scope';
import type { PoolClient } from 'pg';
import { z } from 'zod';

const sourceSchema = z.string().regex(/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/);
type Reference = { intentId: string } | { rideId: string } | { attemptId: string };

/** Trusted backend scope, within a transaction. Resolves a persisted payment, never provider metadata. */
export async function bindPaymentCustomerRead(client: PoolClient, source: string, reference: Reference) {
  sourceSchema.parse(source);
  const field = 'intentId' in reference ? 'intent_id' : 'rideId' in reference ? 'ride_id' : 'id';
  const value =
    'intentId' in reference
      ? reference.intentId
      : 'rideId' in reference
        ? reference.rideId
        : reference.attemptId;
  if (field === 'intent_id')
    z.string()
      .regex(/^pi_[a-zA-Z0-9]{1,96}$/)
      .parse(value);
  else z.uuid().parse(value);
  await client.query(
    "SELECT set_config('rove.customer_source',$1,true),set_config('rove.customer_read','',true),set_config('rove.customer_write','',true),set_config('rove.customer_result','',true)",
    [source],
  );
  await bindPaymentAttemptRead(client, source, reference);
  const row = (
    await client.query<{ customer_binding_id: string }>(
      `SELECT customer_binding_id FROM payment_attempts WHERE source=$1 AND ${field}=$2`,
      [source, value],
    )
  ).rows[0];
  await client.query("SELECT set_config('rove.customer_read',$1,true)", [row?.customer_binding_id ?? '']);
}

/** Exact already-dispatched reservation/result, retained even if account closure raced the provider. */
export async function bindPaymentCustomerResult(
  client: PoolClient,
  source: string,
  bindingId: string,
  customerId: string,
) {
  sourceSchema.parse(source);
  z.uuid().parse(bindingId);
  z.string()
    .regex(/^cus_[a-zA-Z0-9]{1,96}$/)
    .parse(customerId);
  await client.query(
    "SELECT set_config('rove.customer_source',$1,true),set_config('rove.customer_read','',true),set_config('rove.customer_write',$2,true),set_config('rove.customer_result',$3,true)",
    [source, bindingId, customerId],
  );
}
