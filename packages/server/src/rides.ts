import { scheduleSearchExpiry } from './search-expiry';
import type { Pool, PoolClient } from 'pg';
import { Quote, type RideState } from '@rove/contracts';
import { DomainError } from './errors';
import { assertNotExpired, assertTransition, type ActorRole } from './policy';
import { command, event } from './transactions';

export interface Actor {
  id: string;
  role: ActorRole;
  mfa?: boolean;
}
interface RideRow {
  id: string;
  rider_id: string;
  driver_id: string | null;
  state: RideState;
  version: number;
  quote_id: string;
  fare_cents: number;
  earnings_cents: number;
  payment_state: string;
  search_deadline: Date;
}
export function rideSummary(row: RideRow) {
  return {
    id: row.id,
    state: row.state,
    version: row.version,
    fare: { amount: row.fare_cents, currency: 'USD' },
    paymentState: row.payment_state,
  };
}
async function lockRide(client: PoolClient, id: string): Promise<RideRow> {
  const { rows } = await client.query<RideRow>('SELECT * FROM rides WHERE id=$1 FOR UPDATE', [id]);
  if (!rows[0]) throw new DomainError('NOT_FOUND', 'Ride not found.', 404);
  return rows[0];
}
function requireRole(actor: Actor, role: ActorRole) {
  if (actor.role !== role)
    throw new DomainError('FORBIDDEN', 'This action is unavailable for your account.', 403);
}
export class RideService {
  constructor(
    private pool: Pool,
    private now: () => Date = () => new Date(),
  ) {}

  async request(actor: Actor, quoteId: string, key: string) {
    requireRole(actor, 'rider');
    return command(this.pool, actor.id, key, { action: 'request', quoteId }, async (client) => {
      const found = await client.query<{ snapshot: unknown }>(
        'SELECT snapshot FROM quotes WHERE id=$1 AND rider_id=$2 FOR UPDATE',
        [quoteId, actor.id],
      );
      if (!found.rows[0]) throw new DomainError('NOT_FOUND', 'Quote not found.', 404);
      const quote = Quote.parse(found.rows[0].snapshot);
      assertNotExpired(quote.expiresAt, this.now());
      const { rows } = await client.query<RideRow>(
        `INSERT INTO rides (quote_id,rider_id,fare_cents,earnings_cents,search_deadline)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [
          quoteId,
          actor.id,
          quote.fare.amount,
          quote.estimatedDriverEarnings.amount,
          new Date(this.now().getTime() + 180_000),
        ],
      );
      const ride = rows[0]!;
      // Matching is allowed only after the payment worker records authorization.
      await event(client, ride.id, 'ride.requested', actor.id, ride.version);
      await scheduleSearchExpiry(client, ride.id, ride.search_deadline);
      return rideSummary(ride);
    });
  }

  async accept(actor: Actor, offerId: string, key: string) {
    requireRole(actor, 'driver');
    return command(this.pool, actor.id, key, { action: 'accept', offerId }, async (client) => {
      // Find owner first without disclosing existence to other drivers. Lock order is always ride then offer.
      const first = await client.query<{ ride_id: string }>(
        'SELECT ride_id FROM offers WHERE id=$1 AND driver_id=$2',
        [offerId, actor.id],
      );
      if (!first.rows[0]) throw new DomainError('NOT_FOUND', 'Offer not found.', 404);
      const ride = await lockRide(client, first.rows[0].ride_id);
      const offer = (
        await client.query<{ status: string; expires_at: Date }>(
          'SELECT status,expires_at FROM offers WHERE id=$1 FOR UPDATE',
          [offerId],
        )
      ).rows[0]!;
      if (offer.status !== 'pending' || ride.state !== 'searching' || ride.payment_state !== 'authorized') {
        throw new DomainError('OFFER_UNAVAILABLE', 'This offer is no longer available.');
      }
      assertNotExpired(offer.expires_at.toISOString(), this.now());
      assertNotExpired(ride.search_deadline.toISOString(), this.now());
      const driver = (
        await client.query<{
          approved: boolean;
          online: boolean;
          disabled: boolean;
          location_at: Date | null;
          payout_ready: boolean;
          eligibility_expires_at: Date | null;
          service: string;
        }>(
          'SELECT d.approved,d.online,d.location_at,d.payout_ready,d.eligibility_expires_at,d.service,u.disabled FROM drivers d JOIN users u ON u.id=d.id WHERE d.id=$1 FOR UPDATE OF d',
          [actor.id],
        )
      ).rows[0];
      if (
        !driver?.approved ||
        !driver.online ||
        driver.disabled ||
        !driver.payout_ready ||
        !driver.eligibility_expires_at ||
        driver.eligibility_expires_at <= this.now() ||
        !driver.location_at ||
        this.now().getTime() - driver.location_at.getTime() >= 60_000
      ) {
        throw new DomainError('DRIVER_UNAVAILABLE', 'Go online with a current location to accept rides.');
      }
      const quote = Quote.parse(
        (
          await client.query<{ snapshot: unknown }>('SELECT snapshot FROM quotes WHERE id=$1', [
            ride.quote_id,
          ])
        ).rows[0]!.snapshot,
      );
      if (quote.service === 'accessible' && driver.service !== 'accessible')
        throw new DomainError('DRIVER_UNAVAILABLE', 'This ride requires an eligible accessible vehicle.');
      const updated = (
        await client.query<RideRow>(
          "UPDATE rides SET driver_id=$2,state='matched',version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [ride.id, actor.id],
        )
      ).rows[0]!;
      await client.query("UPDATE offers SET status='accepted' WHERE id=$1", [offerId]);
      await event(client, ride.id, 'ride.matched', actor.id, updated.version);
      return rideSummary(updated);
    });
  }

  async transition(actor: Actor, rideId: string, to: RideState, version: number, key: string) {
    return command(
      this.pool,
      actor.id,
      key,
      { action: 'transition', rideId, to, version },
      async (client) => {
        const ride = await lockRide(client, rideId);
        // Staff requires a separate audited permission/reason use case, not this consumer endpoint.
        if (
          actor.role === 'staff' ||
          (actor.role === 'rider' ? ride.rider_id : ride.driver_id) !== actor.id
        ) {
          throw new DomainError('NOT_FOUND', 'Ride not found.', 404);
        }
        if (ride.version !== version)
          throw new DomainError('STALE_RIDE', 'Your trip has changed. Refresh to continue.');
        assertTransition(ride.state, to, actor.role);
        if (['en_route', 'arrived', 'in_progress'].includes(to) && ride.payment_state !== 'authorized')
          throw new DomainError(
            'PAYMENT_REQUIRED',
            'Payment must be confirmed before continuing pickup.',
            409,
          );
        const updated = (
          await client.query<RideRow>(
            'UPDATE rides SET state=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',
            [rideId, to],
          )
        ).rows[0]!;
        if (to === 'cancelled')
          await client.query("UPDATE offers SET status='revoked' WHERE ride_id=$1 AND status='pending'", [
            rideId,
          ]);
        await event(client, rideId, `ride.${to}`, actor.id, updated.version);
        return rideSummary(updated);
      },
    );
  }
}
