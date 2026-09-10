import type { Pool } from 'pg';
import { z } from 'zod';
import { command, transaction } from './transactions';
import { requireStaffPermission } from './staff-access';
import { DomainError } from './errors';
import type { Actor } from './rides';

export const EligibilityDecision = z.discriminatedUnion('decision', [
  z
    .object({
      decision: z.literal('approved'),
      vehicleRevision: z.uuid(),
      documentIds: z.array(z.uuid()).length(3),
      clearanceReference: z.string().trim().min(1).max(128),
      clearanceExpiresAt: z.iso.datetime(),
      operatingRequirementsConfirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      decision: z.literal('revoked'),
      reason: z.enum(['documents', 'vehicle', 'operating_requirements', 'safety_review']),
    })
    .strict(),
]);
/** Staff attests external operating clearance; this does not perform background checks or enable payouts. */
export class DriverEligibilityService {
  constructor(private pool: Pool) {}
  async decide(actor: Actor, rawId: string, raw: unknown, key: string) {
    const driverId = z.uuid().parse(rawId),
      input = EligibilityDecision.parse(raw);
    const authorize = (client: import('pg').PoolClient) =>
      requireStaffPermission(client, actor, 'driver.eligibility.review');
    await transaction(this.pool, (client) => authorize(client));
    return command(
      this.pool,
      actor.id,
      key,
      { action: 'driver.eligibility', driverId, ...input },
      async (client) => {
        await authorize(client);
        const driver = (
          await client.query(
            'SELECT d.*,u.disabled FROM drivers d JOIN users u ON u.id=d.id WHERE d.id=$1 FOR UPDATE OF d,u',
            [driverId],
          )
        ).rows[0];
        if (!driver || driver.disabled) throw new DomainError('NOT_FOUND', 'Driver unavailable.', 404);
        if (input.decision === 'revoked') {
          await client.query('UPDATE drivers SET approved=false,eligibility_expires_at=NULL WHERE id=$1', [
            driverId,
          ]);
          await client.query(
            "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'staff.driver_eligibility_revoked',$2,$3)",
            [actor.id, driverId, JSON.stringify({ reason: input.reason })],
          );
          return { approved: false, expiresAt: null };
        }
        if (driver.online)
          throw new DomainError('DRIVER_ONLINE', 'Go offline before eligibility review.', 409);
        if (
          (
            await client.query(
              "SELECT 1 FROM rides WHERE driver_id=$1 AND state IN ('matched','en_route','arrived','in_progress','interrupted')",
              [driverId],
            )
          ).rowCount
        )
          throw new DomainError('ACTIVE_TRIP', 'Resolve the active trip before eligibility review.', 409);
        const vehicle = (
          await client.query('SELECT revision,status FROM driver_vehicle_submissions WHERE driver_id=$1', [
            driverId,
          ])
        ).rows[0];
        if (!vehicle || vehicle.status !== 'approved' || vehicle.revision !== input.vehicleRevision)
          throw new DomainError('REVIEW_CHANGED', 'Review the current approved vehicle.', 409);
        const now = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
        const documents = (
          await client.query(
            `SELECT d.id,d.kind,d.object_key,d.object_version,d.expected_sha256,r.expires_at
         FROM driver_documents d JOIN driver_document_reviews r ON r.document_id=d.id
         JOIN driver_document_scans s ON s.document_id=d.id
         WHERE d.driver_id=$1 AND d.state='quarantined' AND r.decision='approved' AND r.expires_at>$2
           AND s.state='clean' AND s.scanned_key=d.object_key AND s.scanned_version=d.object_version AND s.scanned_sha256=d.expected_sha256
           AND r.object_key=d.object_key AND r.object_version=d.object_version AND r.sha256=d.expected_sha256
           AND NOT EXISTS(SELECT 1 FROM driver_documents newer WHERE newer.driver_id=d.driver_id AND newer.kind=d.kind AND newer.state='quarantined' AND (newer.created_at,newer.id)>(d.created_at,d.id))
         FOR SHARE OF d,r,s`,
            [driverId, now],
          )
        ).rows;
        if (
          documents.length !== 3 ||
          new Set(documents.map((d) => d.kind)).size !== 3 ||
          new Set(input.documentIds).size !== 3 ||
          !documents.every((d) => input.documentIds.includes(d.id))
        )
          throw new DomainError(
            'DOCUMENTS_REQUIRED',
            'Review all three current, unexpired driving documents.',
            409,
          );
        const expiry = new Date(
          Math.min(
            Date.parse(input.clearanceExpiresAt),
            ...documents.map((d) => (d.expires_at as Date).getTime()),
          ),
        );
        if (expiry <= now)
          throw new DomainError('CLEARANCE_EXPIRED', 'Operating clearance must still be valid.', 422);
        await client.query('UPDATE drivers SET approved=true,eligibility_expires_at=$2 WHERE id=$1', [
          driverId,
          expiry,
        ]);
        await client.query(
          "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'staff.driver_eligibility_approved',$2,$3)",
          [
            actor.id,
            driverId,
            JSON.stringify({
              vehicleRevision: input.vehicleRevision,
              documentIds: input.documentIds,
              clearanceReference: input.clearanceReference,
              clearanceExpiresAt: input.clearanceExpiresAt,
              expiresAt: expiry.toISOString(),
            }),
          ],
        );
        return { approved: true, expiresAt: expiry.toISOString() };
      },
    );
  }
}
