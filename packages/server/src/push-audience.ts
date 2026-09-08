import type { Pool } from 'pg';
import { z } from 'zod';
import { PushMessage } from './push-provider';

const rideTopics = new Set([
  'ride.matched',
  'ride.en_route',
  'ride.arrived',
  'ride.in_progress',
  'ride.completed',
  'ride.cancelled',
  'ride.no_driver_found',
  'ride.no_show',
  'ride.interrupted',
  'ride.terminated',
]);
export const PushRecipient = z
  .object({
    eventId: z.uuid(),
    installationId: z.uuid(),
    revision: z.number().int().positive(),
  })
  .strict();
export type PushRecipient = z.infer<typeof PushRecipient>;
type Audience = {
  kind: 'ride_update' | 'offer_available';
  referenceId: string;
  expiresAt: Date;
  riderId: string | null;
  driverId: string | null;
};

/** Read-only authorization used at fan-out and again immediately before transport.
 * No notification content or recipient identity is trusted from a queued payload.
 */
export class PushAudience {
  constructor(
    private pool: Pool,
    private projects: Partial<Record<'rider' | 'driver', string>>,
    private now: () => Date = () => new Date(),
  ) {
    for (const project of Object.values(projects)) z.uuid().parse(project);
    if (projects.rider && projects.rider === projects.driver)
      throw new Error('Rider and driver push projects must differ.');
  }
  private async event(id: string, now: Date): Promise<Audience | null> {
    z.uuid().parse(id);
    const event = (
      await this.pool.query<{
        topic: string;
        aggregate_id: string;
        payload: unknown;
        expires_at: Date;
      }>(
        `SELECT topic,aggregate_id,payload,created_at+interval '5 minutes' AS expires_at
      FROM outbox WHERE id=$1 AND created_at<=$2 AND created_at>$2::timestamptz-interval '5 minutes'`,
        [id, now],
      )
    ).rows[0];
    if (!event) return null;
    if (rideTopics.has(event.topic)) {
      const ride = (
        await this.pool.query<{ rider_id: string; driver_id: string | null }>(
          'SELECT rider_id,driver_id FROM rides WHERE id=$1',
          [event.aggregate_id],
        )
      ).rows[0];
      return ride
        ? {
            kind: 'ride_update',
            referenceId: event.aggregate_id,
            expiresAt: event.expires_at,
            riderId: ride.rider_id,
            driverId: ride.driver_id,
          }
        : null;
    }
    if (event.topic !== 'offer.created') return null;
    const payload = z.object({ offerId: z.uuid(), driverId: z.uuid() }).strict().safeParse(event.payload);
    if (!payload.success) return null;
    const offer = (
      await this.pool.query<{ id: string; driver_id: string; expires_at: Date }>(
        `SELECT o.id,o.driver_id,LEAST(o.expires_at,r.search_deadline,$4::timestamptz) AS expires_at
       FROM offers o JOIN rides r ON r.id=o.ride_id JOIN drivers d ON d.id=o.driver_id
       WHERE o.id=$1 AND o.ride_id=$2 AND o.driver_id=$5 AND o.status='pending' AND o.expires_at>$3
       AND r.state='searching' AND r.payment_state='authorized' AND r.search_deadline>$3
       AND d.online=true AND d.approved=true AND d.payout_ready=true AND d.payout_valid_until>$3
       AND d.eligibility_expires_at>$3 AND d.location_at>$3::timestamptz-interval '60 seconds'`,
        [payload.data.offerId, event.aggregate_id, now, event.expires_at, payload.data.driverId],
      )
    ).rows[0];
    return offer
      ? {
          kind: 'offer_available',
          referenceId: offer.id,
          expiresAt: offer.expires_at,
          riderId: null,
          driverId: offer.driver_id,
        }
      : null;
  }
  private installations(audience: Audience, now: Date, recipient?: PushRecipient) {
    return this.pool.query<{ id: string; revision: number; token: string }>(
      `SELECT p.id,p.revision,p.token FROM push_installations p JOIN users u ON u.id=p.owner_id
       WHERE p.enabled=true AND u.disabled=false AND p.updated_at>$1::timestamptz-interval '30 days'
       AND ((u.role='rider' AND p.owner_id=$2 AND p.project_id=$3)
         OR (u.role='driver' AND p.owner_id=$4 AND p.project_id=$5))
       AND ($6::uuid IS NULL OR (p.id=$6 AND p.revision=$7)) ORDER BY p.id LIMIT 20`,
      [
        now,
        audience.riderId,
        this.projects.rider ?? null,
        audience.driverId,
        this.projects.driver ?? null,
        recipient?.installationId ?? null,
        recipient?.revision ?? null,
      ],
    );
  }
  async recipients(eventId: string): Promise<PushRecipient[]> {
    const now = this.now();
    const audience = await this.event(eventId, now);
    if (!audience) return [];
    const { rows } = await this.installations(audience, now);
    return rows.map((row) => ({ eventId, installationId: row.id, revision: row.revision }));
  }
  async message(raw: PushRecipient): Promise<PushMessage | null> {
    const recipient = PushRecipient.parse(raw);
    const now = this.now();
    const audience = await this.event(recipient.eventId, now);
    if (!audience) return null;
    const row = (await this.installations(audience, now, recipient)).rows[0];
    if (!row) return null;
    return PushMessage.parse({
      token: row.token,
      expiresAt: audience.expiresAt.toISOString(),
      hint: { eventId: recipient.eventId, kind: audience.kind, referenceId: audience.referenceId },
    });
  }
}
