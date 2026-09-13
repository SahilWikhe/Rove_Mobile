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
    "SELECT set_config('rove.payment_attempt_read',$1,true),set_config('rove.payment_attempt_write','',true)",
    [JSON.stringify({ source: sourceSchema.parse(source), ...selected })],
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
