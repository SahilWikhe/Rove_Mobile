import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { VehicleSubmissionUpdate, VehicleReviewResponse } from '@rove/contracts';
import { driverOnly } from './drivers';
import type { Actor } from './rides';
import { transaction } from './transactions';
import { DomainError } from './errors';
export class VehicleSubmissionService {
  constructor(private pool: Pool) {}
  async get(actor: Actor) {
    driverOnly(actor);
    const row = (
      await this.pool.query(
        'SELECT s.revision,s.vehicle,s.status,s.submitted_at,d.corrections FROM driver_vehicle_submissions s LEFT JOIN vehicle_review_decisions d ON d.revision=s.revision WHERE s.driver_id=$1',
        [actor.id],
      )
    ).rows[0];
    return VehicleReviewResponse.parse({
      submission: row
        ? {
            revision: row.revision,
            vehicle: row.vehicle,
            status: row.status,
            corrections: row.status === 'rejected' ? (row.corrections ?? []) : [],
            submittedAt: row.submitted_at.toISOString(),
          }
        : null,
    });
  }
  async submit(actor: Actor, raw: unknown) {
    driverOnly(actor);
    const input = VehicleSubmissionUpdate.parse(raw);
    return transaction(this.pool, async (client) => {
      const driver = (
        await client.query(
          'SELECT d.online,u.disabled FROM drivers d JOIN users u ON u.id=d.id WHERE d.id=$1 FOR UPDATE OF d',
          [actor.id],
        )
      ).rows[0];
      if (!driver || driver.disabled)
        throw new DomainError('FORBIDDEN', 'This account cannot submit a vehicle.', 403);
      const previous = (
        await client.query(
          'SELECT revision,vehicle,status,submitted_at FROM driver_vehicle_submissions WHERE driver_id=$1',
          [actor.id],
        )
      ).rows[0];
      if (
        previous?.status === 'pending' &&
        JSON.stringify(
          VehicleSubmissionUpdate.parse({ vehicle: previous.vehicle, expectedRevision: null }).vehicle,
        ) === JSON.stringify(input.vehicle)
      )
        return VehicleReviewResponse.parse({
          submission: {
            revision: previous.revision,
            vehicle: previous.vehicle,
            status: previous.status,
            submittedAt: previous.submitted_at.toISOString(),
          },
        });
      if ((previous?.revision ?? null) !== input.expectedRevision)
        throw new DomainError(
          'VEHICLE_CHANGED',
          'Your vehicle submission changed. Reload before submitting.',
          409,
        );
      if (driver.online)
        throw new DomainError('GO_OFFLINE', 'Go offline before submitting vehicle changes.', 409);
      const active = await client.query(
        "SELECT id FROM rides WHERE driver_id=$1 AND state IN ('matched','en_route','arrived','in_progress','interrupted')",
        [actor.id],
      );
      if (active.rowCount)
        throw new DomainError(
          'ACTIVE_TRIP',
          'Finish or resolve your current trip before changing vehicles.',
          409,
        );
      const revision = randomUUID();
      const row = (
        await client.query(
          "INSERT INTO driver_vehicle_submissions(driver_id,revision,vehicle,status) VALUES($1,$2,$3,'pending') ON CONFLICT(driver_id) DO UPDATE SET revision=EXCLUDED.revision,vehicle=EXCLUDED.vehicle,status='pending',submitted_at=now() RETURNING submitted_at",
          [actor.id, revision, JSON.stringify(input.vehicle)],
        )
      ).rows[0];
      await client.query(
        'INSERT INTO driver_vehicle_history(revision,driver_id,vehicle,submitted_at) VALUES($1,$2,$3,$4)',
        [revision, actor.id, JSON.stringify(input.vehicle), row.submitted_at],
      );
      await client.query(
        'UPDATE drivers SET approved=false,eligibility_expires_at=NULL,location=NULL,location_at=NULL WHERE id=$1',
        [actor.id],
      );
      await client.query('DELETE FROM driver_tracking_sessions WHERE driver_id=$1', [actor.id]);
      await client.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'driver.vehicle_submitted',$1,$2)",
        [actor.id, JSON.stringify({ revision })],
      );
      // Unverified details never replace the effective vehicle/service visible to riders.
      return VehicleReviewResponse.parse({
        submission: {
          revision,
          vehicle: input.vehicle,
          status: 'pending',
          submittedAt: row.submitted_at.toISOString(),
        },
      });
    });
  }
}
