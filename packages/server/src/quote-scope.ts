import type { PoolClient } from 'pg';
import { z } from 'zod';
/** Backend-only quote scope. Services authorize riders and ride-worker operations before binding. */
export async function bindQuoteOwner(client: PoolClient, riderId: string) {
  z.uuid().parse(riderId);
  await client.query("SELECT set_config('rove.quote_owner',$1,true),set_config('rove.quote_ride','',true)", [
    riderId,
  ]);
}
export async function bindQuoteRide(client: PoolClient, rideId: string) {
  z.uuid().parse(rideId);
  await client.query("SELECT set_config('rove.quote_owner','',true),set_config('rove.quote_ride',$1,true)", [
    rideId,
  ]);
}
