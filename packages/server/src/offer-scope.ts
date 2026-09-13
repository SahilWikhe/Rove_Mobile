import type { PoolClient } from 'pg';
import { z } from 'zod';
/** Trusted backend matching/lifecycle scope, bound only after the service authorizes its operation. */
export async function bindOfferRide(c: PoolClient, rideId: string, matching = false) {
  z.uuid().parse(rideId);
  await c.query("SELECT set_config('rove.offer_ride',$1,true),set_config('rove.offer_matching',$2,true)", [
    rideId,
    matching ? 'true' : 'false',
  ]);
}
