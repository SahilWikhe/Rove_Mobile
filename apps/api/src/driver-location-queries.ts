import type { Pool } from 'pg';
import { Coordinate, RideDriverLocation } from '@rove/contracts';
import { DomainError, type Actor } from '@rove/server';

/** A rider can read only their currently assigned driver's recent sample. */
export async function getDriverLocation(pool: Pool, actor: Actor, rideId: string, now = new Date()) {
  if (actor.role !== 'rider') throw new DomainError('NOT_FOUND', 'Driver location not available.', 404);
  const { rows } = await pool.query<{
    location: unknown;
    location_sampled_at: Date | null;
    online: boolean;
    disabled: boolean;
  }>(
    `SELECT d.location,d.location_sampled_at,d.online,u.disabled
      FROM rides r JOIN users owner ON owner.id=r.rider_id
      JOIN drivers d ON d.id=r.driver_id JOIN users u ON u.id=d.id
      WHERE r.id=$1 AND r.rider_id=$2 AND NOT owner.disabled
        AND r.state IN ('matched','en_route','arrived','in_progress','interrupted')`,
    [rideId, actor.id],
  );
  const row = rows[0];
  if (!row) throw new DomainError('NOT_FOUND', 'Driver location not available.', 404);
  const point = Coordinate.safeParse(row.location);
  const sampledAt = row.location_sampled_at;
  const age = sampledAt ? now.getTime() - sampledAt.getTime() : Infinity;
  const fresh = row.online && !row.disabled && point.success && age >= -5000 && age < 60000;
  return RideDriverLocation.parse({
    rideId,
    location:
      fresh && sampledAt && point.success
        ? {
            coordinate: point.data,
            sampledAt: sampledAt.toISOString(),
            expiresAt: new Date(sampledAt.getTime() + 60000).toISOString(),
            validForMs: Math.min(60000, 60000 - age),
          }
        : null,
  });
}
