import type { Pool } from 'pg';
import { Coordinate, DriverOffer } from '@rove/contracts';
import { DomainError } from './errors';
import { command } from './transactions';
import type { Actor } from './rides';

export function driverOnly(actor: Actor) {
  if (actor.role !== 'driver') throw new DomainError('FORBIDDEN', 'A driver account is required.', 403);
}
export class DriverService {
  constructor(
    private pool: Pool,
    private now: () => Date = () => new Date(),
  ) {}
  async profile(actor: Actor) {
    driverOnly(actor);
    const row = (
      await this.pool.query(
        'SELECT approved,online,payout_ready,payout_valid_until,eligibility_expires_at,location_at,location_sequence,vehicle,service FROM drivers WHERE id=$1',
        [actor.id],
      )
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND', 'Driver profile not found.', 404);
    return {
      approved: row.approved,
      online: row.online,
      payoutReady: !!(row.payout_ready && row.payout_valid_until > this.now()),
      eligible:
        row.approved &&
        row.payout_ready &&
        row.payout_valid_until > this.now() &&
        row.eligibility_expires_at?.getTime() > this.now().getTime(),
      locationAt: row.location_at?.toISOString() ?? null,
      locationSequence: row.location_sequence,
      vehicle: row.vehicle,
      service: row.service,
    };
  }
  async availability(actor: Actor, online: boolean, coordinate: Coordinate | undefined, key: string) {
    driverOnly(actor);
    if (coordinate) Coordinate.parse(coordinate);
    return command(
      this.pool,
      actor.id,
      key,
      { action: 'availability', online, coordinate },
      async (client) => {
        // Going offline may revoke a pending offer, but it cannot abandon accepted work.
        const row = (
          await client.query(
            'SELECT d.*,u.disabled FROM drivers d JOIN users u ON u.id=d.id WHERE d.id=$1 FOR UPDATE OF d',
            [actor.id],
          )
        ).rows[0];
        if (!row) throw new DomainError('NOT_FOUND', 'Driver profile not found.', 404);
        if (
          online &&
          (!row.approved ||
            !row.payout_ready ||
            !row.payout_valid_until ||
            row.payout_valid_until <= this.now() ||
            row.disabled ||
            !row.eligibility_expires_at ||
            row.eligibility_expires_at <= this.now())
        ) {
          throw new DomainError(
            'DRIVER_INELIGIBLE',
            'Complete your document review and payout setup before going online.',
            403,
          );
        }
        if (online && !coordinate)
          throw new DomainError('LOCATION_REQUIRED', 'A current location is required to go online.', 422);
        const active = await client.query(
          "SELECT id FROM rides WHERE driver_id=$1 AND state IN ('matched','en_route','arrived','in_progress','interrupted')",
          [actor.id],
        );
        if (!online && active.rowCount)
          throw new DomainError('ACTIVE_TRIP', 'Finish or resolve your active trip before going offline.');
        await client.query(
          'UPDATE drivers SET online=$2,location=CASE WHEN $2 THEN $3::jsonb ELSE NULL END,location_at=CASE WHEN $2 THEN $4::timestamptz ELSE NULL END,location_sampled_at=NULL,location_sequence=location_sequence+1 WHERE id=$1',
          [actor.id, online, JSON.stringify(coordinate ?? null), this.now()],
        );
        // Offline revokes background upload access even if a device retains its credential.
        if (!online)
          await client.query('DELETE FROM driver_tracking_sessions WHERE driver_id=$1', [actor.id]);
        // Do not lock ride rows here: acceptance takes the ride lock before driver lock.
        // The matching worker observes offline state and expires/revokes this offer safely.
        return { online };
      },
    );
  }
  async heartbeat(
    actor: Actor,
    input: { coordinate: Coordinate; sequence: number; sampledAt: string; accuracyMeters: number },
  ) {
    driverOnly(actor);
    Coordinate.parse(input.coordinate);
    const age = this.now().getTime() - Date.parse(input.sampledAt);
    if (
      !Number.isFinite(age) ||
      age < -5000 ||
      age > 30_000 ||
      !Number.isSafeInteger(input.sequence) ||
      input.sequence < 1 ||
      !Number.isFinite(input.accuracyMeters) ||
      input.accuracyMeters < 0 ||
      input.accuracyMeters > 100
    ) {
      throw new DomainError('INVALID_LOCATION_SAMPLE', 'A fresh, accurate location is required.', 422);
    }
    const updated = await this.pool.query(
      'UPDATE drivers SET location=$2,location_at=$3,location_sequence=$4,location_sampled_at=$5 WHERE id=$1 AND online=true AND location_sequence<$4 AND (location_sampled_at IS NULL OR location_sampled_at<$5) RETURNING id',
      [actor.id, JSON.stringify(input.coordinate), this.now(), input.sequence, new Date(input.sampledAt)],
    );
    if (!updated.rowCount)
      throw new DomainError('STALE_LOCATION_SAMPLE', 'Refresh your driver session before sending location.');
    return { accepted: true };
  }
  async offers(actor: Actor) {
    driverOnly(actor);
    const rows = (
      await this.pool.query(
        `SELECT o.snapshot FROM offers o JOIN rides r ON r.id=o.ride_id JOIN drivers d ON d.id=o.driver_id
      WHERE o.driver_id=$1 AND o.status='pending' AND o.expires_at>$2 AND r.state='searching' AND r.payment_state='authorized'
      AND r.search_deadline>$2 AND d.online=true AND d.approved=true AND d.payout_ready=true AND d.payout_valid_until>$2 AND d.eligibility_expires_at>$2 AND d.location_at>$2::timestamptz-interval '60 seconds'`,
        [actor.id, this.now()],
      )
    ).rows;
    return { offers: rows.map((row) => DriverOffer.parse(row.snapshot)) };
  }
  async decline(actor: Actor, offerId: string, key: string) {
    driverOnly(actor);
    return command(this.pool, actor.id, key, { action: 'decline', offerId }, async (client) => {
      const reference = (
        await client.query('SELECT ride_id FROM offers WHERE id=$1 AND driver_id=$2', [offerId, actor.id])
      ).rows[0];
      if (!reference) throw new DomainError('NOT_FOUND', 'Offer not found.', 404);
      await client.query('SELECT id FROM rides WHERE id=$1 FOR UPDATE', [reference.ride_id]);
      const result = await client.query(
        "UPDATE offers SET status='declined' WHERE id=$1 AND status='pending' RETURNING id",
        [offerId],
      );
      if (!result.rowCount) throw new DomainError('OFFER_UNAVAILABLE', 'This offer is no longer available.');
      await client.query(
        "INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES ('matching.tick',$1,'{}',$2) ON CONFLICT DO NOTHING",
        [reference.ride_id, `declined:${offerId}`],
      );
      return { declined: true };
    });
  }
}
