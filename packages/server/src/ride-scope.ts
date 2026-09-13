import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Quote } from '@rove/contracts';

const mutationKind = z.enum(['assignment', 'transition', 'expiry', 'payment']);
/** Internal scope: callers authorize the operation before binding a persisted ride reference. */
export async function bindRideRead(client: PoolClient, rideId: string) {
  z.uuid().parse(rideId);
  await client.query(
    "SELECT set_config('rove.ride_read',$1,true),set_config('rove.ride_write','',true),set_config('rove.ride_batch','',true),set_config('rove.ride_expiry_before','',true),set_config('rove.ride_create','',true)",
    [rideId],
  );
}
/** Capture the locked persisted row so a mutation cannot change unrelated fields or another ride. */
export async function bindRideMutation(
  client: PoolClient,
  rideId: string,
  kind: z.infer<typeof mutationKind>,
) {
  z.uuid().parse(rideId);
  mutationKind.parse(kind);
  await client.query(
    "SELECT set_config('rove.ride_write','',true),set_config('rove.ride_batch','',true),set_config('rove.ride_expiry_before','',true)",
  );
  await client.query(
    "SELECT set_config('rove.ride_write',jsonb_build_object('kind',$2::text,'before',to_jsonb(r))::text,true) FROM rides r WHERE id=$1 FOR UPDATE",
    [rideId, kind],
  );
}
/** Bind the already locked, validated quote and exact deadline chosen by the booking service. */
export async function bindRideCreation(client: PoolClient, rawQuote: unknown, deadline: Date) {
  const quote = Quote.parse(rawQuote);
  z.date().parse(deadline);
  await client.query(
    "SELECT set_config('rove.ride_read','',true),set_config('rove.ride_write','',true),set_config('rove.ride_batch','',true),set_config('rove.ride_expiry_before','',true),set_config('rove.ride_create',jsonb_build_object('quoteId',$1::uuid,'riderId',$2::uuid,'fare',$3::integer,'earnings',$4::integer,'deadline',$5::timestamptz)::text,true)",
    [quote.id, quote.riderId, quote.fare.amount, quote.estimatedDriverEarnings.amount, deadline],
  );
}
