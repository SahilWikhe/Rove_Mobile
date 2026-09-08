import type { Pool, PoolClient } from 'pg';
import { VehicleReviewDecision, VehicleSubmission } from '@rove/contracts';
import { command, transaction } from './transactions';
import { DomainError } from './errors';
import type { Actor } from './rides';
async function authorize(client: PoolClient, actor: Actor) {
  if (actor.role !== 'staff')
    throw new DomainError('FORBIDDEN', 'Vehicle review permission is required.', 403);
  const result = await client.query(
    "SELECT u.id FROM users u JOIN staff_permissions p ON p.staff_id=u.id WHERE u.id=$1 AND u.role='staff' AND u.disabled=false AND p.permission='driver.vehicle.review' FOR SHARE OF u,p",
    [actor.id],
  );
  if (!result.rowCount) throw new DomainError('FORBIDDEN', 'Vehicle review permission is required.', 403);
}
export class VehicleReviewService {
  constructor(private pool: Pool) {}
  async inspect(actor: Actor, driverId: string) {
    return transaction(this.pool, async (client) => {
      await authorize(client, actor);
      const row = (
        await client.query(
          'SELECT revision,vehicle,status,submitted_at FROM driver_vehicle_submissions WHERE driver_id=$1',
          [driverId],
        )
      ).rows[0];
      if (!row) throw new DomainError('NOT_FOUND', 'Vehicle submission not found.', 404);
      await client.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'staff.vehicle_viewed',$2,$3)",
        [actor.id, driverId, JSON.stringify({ revision: row.revision })],
      );
      return {
        revision: row.revision,
        vehicle: VehicleSubmission.parse(row.vehicle),
        status: row.status,
        submittedAt: row.submitted_at.toISOString(),
      };
    });
  }
  async decide(actor: Actor, driverId: string, raw: unknown, key: string) {
    const input = VehicleReviewDecision.parse(raw);
    // Recheck permission even on an idempotent replay; revoked staff cannot retrieve prior results.
    await transaction(this.pool, (client) => authorize(client, actor));
    return command(
      this.pool,
      actor.id,
      key,
      { action: 'vehicle.review', driverId, ...input },
      async (client) => {
        await authorize(client, actor);
        const driver = (
          await client.query('SELECT id,online FROM drivers WHERE id=$1 FOR UPDATE', [driverId])
        ).rows[0];
        if (!driver) throw new DomainError('NOT_FOUND', 'Driver not found.', 404);
        const row = (
          await client.query(
            'SELECT revision,vehicle,status FROM driver_vehicle_submissions WHERE driver_id=$1',
            [driverId],
          )
        ).rows[0];
        if (!row || row.revision !== input.revision || row.status !== 'pending')
          throw new DomainError(
            'REVIEW_CHANGED',
            'Reload the current pending submission before reviewing.',
            409,
          );
        if (driver.online)
          throw new DomainError('DRIVER_ONLINE', 'The driver must be offline before review.', 409);
        const active = await client.query(
          "SELECT id FROM rides WHERE driver_id=$1 AND state IN ('matched','en_route','arrived','in_progress','interrupted')",
          [driverId],
        );
        if (active.rowCount)
          throw new DomainError('ACTIVE_TRIP', 'Resolve the active trip before reviewing this vehicle.', 409);
        const vehicle = VehicleSubmission.parse(row.vehicle);
        if (input.verifiedService === 'accessible' && vehicle.requestedService !== 'accessible')
          throw new DomainError('INVALID_SERVICE', 'Accessible service was not requested.', 422);
        await client.query(
          'INSERT INTO vehicle_review_decisions(revision,reviewer_id,decision,reason,verified_service) VALUES($1,$2,$3,$4,$5)',
          [input.revision, actor.id, input.decision, input.reason, input.verifiedService ?? null],
        );
        await client.query('UPDATE driver_vehicle_submissions SET status=$2 WHERE driver_id=$1', [
          driverId,
          input.decision,
        ]);
        if (input.decision === 'approved')
          await client.query(
            'UPDATE drivers SET vehicle=$2,service=$3,approved=false,eligibility_expires_at=NULL WHERE id=$1',
            [
              driverId,
              JSON.stringify({
                make: vehicle.make,
                model: vehicle.model,
                color: vehicle.color,
                plate: vehicle.plate,
              }),
              input.verifiedService,
            ],
          );
        await client.query(
          "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'staff.vehicle_reviewed',$2,$3)",
          [actor.id, driverId, JSON.stringify({ revision: input.revision, decision: input.decision })],
        );
        return { revision: input.revision, status: input.decision };
      },
    );
  }
}
