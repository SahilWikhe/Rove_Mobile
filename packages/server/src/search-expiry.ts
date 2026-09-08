import type { Pool, PoolClient } from 'pg';
import { transaction, event } from './transactions';

export async function scheduleSearchExpiry(client: PoolClient, rideId: string, deadline: Date) {
  await client.query(
    "INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key,available_at) VALUES('ride.search_expire',$1,'{}',$2,$3) ON CONFLICT(dedupe_key) DO NOTHING",
    [rideId, `search-expire:${rideId}`, deadline],
  );
}
/** Ends abandoned searches without treating an unconfirmed payment as a released hold. */
export class SearchExpiry {
  constructor(
    private pool: Pool,
    private now: () => Date = () => new Date(),
  ) {}
  async expire(rideId: string): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      const ride = (
        await client.query<{ state: string; payment_state: string; version: number; search_deadline: Date }>(
          'SELECT state,payment_state,version,search_deadline FROM rides WHERE id=$1 FOR UPDATE',
          [rideId],
        )
      ).rows[0];
      if (!ride || ride.state !== 'searching' || ride.search_deadline > this.now()) return false;
      const state = ride.payment_state === 'authorized' ? 'no_driver_found' : 'cancelled';
      await client.query("UPDATE offers SET status='expired' WHERE ride_id=$1 AND status='pending'", [
        rideId,
      ]);
      await client.query('UPDATE rides SET state=$2,version=version+1,updated_at=$3 WHERE id=$1', [
        rideId,
        state,
        this.now(),
      ]);
      await event(client, rideId, `ride.${state}`, null, ride.version + 1, {
        reason: 'search_deadline_expired',
      });
      return true;
    });
  }
  /** Bounded recovery for historical/missed jobs. Each candidate is rechecked under its ride lock. */
  async sweep(limit = 50): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Invalid sweep limit.');
    const rows = (
      await this.pool.query<{ id: string }>(
        "SELECT id FROM rides WHERE state='searching' AND search_deadline<=$1 ORDER BY search_deadline,id LIMIT $2",
        [this.now(), limit],
      )
    ).rows;
    let expired = 0;
    for (const row of rows) if (await this.expire(row.id)) expired++;
    return expired;
  }
}
