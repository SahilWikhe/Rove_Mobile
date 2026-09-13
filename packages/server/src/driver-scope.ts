import type { PoolClient } from 'pg';
import { z } from 'zod';

const mutationKind = z.enum([
  'coverage',
  'availability',
  'location',
  'eligibility',
  'invalidate',
  'vehicle',
  'payout',
  'closure',
]);
/** Bind a locked persisted driver snapshot. Policies limit changes to the operation's field set. */
export async function bindDriverMutation(
  client: PoolClient,
  driverId: string,
  kind: z.infer<typeof mutationKind>,
) {
  z.uuid().parse(driverId);
  mutationKind.parse(kind);
  await client.query("SELECT set_config('rove.driver_write','',true)");
  await client.query(
    "SELECT set_config('rove.driver_write',jsonb_build_object('kind',$2::text,'before',to_jsonb(d))::text,true) FROM drivers d WHERE id=$1 FOR UPDATE",
    [driverId, kind],
  );
}
