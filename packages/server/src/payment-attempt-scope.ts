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
  await client.query("SELECT set_config('rove.payment_attempt_read',$1,true)", [
    JSON.stringify({ source: sourceSchema.parse(source), ...selected }),
  ]);
}
