import type { Pool } from 'pg';
import { Quote, RideDetails, RideVehicle } from '@rove/contracts';
import { DomainError, type Actor } from '@rove/server';

export async function getRide(pool: Pool, actor: Actor, rideId: string) {
  // Consumer endpoint intentionally excludes staff. Staff uses separately permissioned APIs.
  const ownerColumn = actor.role === 'rider' ? 'r.rider_id' : actor.role === 'driver' ? 'r.driver_id' : null;
  if (!ownerColumn) throw new DomainError('FORBIDDEN', 'Use the staff API for this operation.', 403);
  const row = (
    await pool.query(
      `SELECT r.*,q.snapshot,u.name AS rider_name,d.name AS driver_name,p.vehicle
    FROM rides r JOIN quotes q ON q.id=r.quote_id JOIN users u ON u.id=r.rider_id
    LEFT JOIN users d ON d.id=r.driver_id LEFT JOIN drivers p ON p.id=d.id
    WHERE r.id=$1 AND ${ownerColumn}=$2`,
      [rideId, actor.id],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND', 'Ride not found.', 404);
  const quote = Quote.parse(row.snapshot);
  const activeAssignment = ['matched', 'en_route', 'arrived', 'in_progress', 'interrupted'].includes(
    row.state,
  );
  const vehicle = RideVehicle.strip().safeParse(row.vehicle);
  return RideDetails.parse({
    id: row.id,
    state: row.state,
    version: row.version,
    fare: { amount: row.fare_cents, currency: 'USD' },
    paymentState: row.payment_state,
    pickupArea: quote.pickup.area,
    destinationArea: quote.destination.area,
    createdAt: row.created_at.toISOString(),
    ...(actor.role === 'rider' || activeAssignment
      ? { pickup: quote.pickup, destination: quote.destination }
      : {}),
    ...(actor.role === 'rider' && activeAssignment && row.driver_name
      ? { driver: { name: row.driver_name, ...(vehicle.success ? { vehicle: vehicle.data } : {}) } }
      : {}),
    ...(actor.role === 'driver' && activeAssignment ? { rider: { name: row.rider_name } } : {}),
  });
}
export async function listRides(pool: Pool, actor: Actor, before?: string) {
  const ownerColumn = actor.role === 'rider' ? 'rider_id' : actor.role === 'driver' ? 'driver_id' : null;
  if (!ownerColumn) throw new DomainError('FORBIDDEN', 'Use the staff API for this operation.', 403);
  const rows = (
    await pool.query<{ id: string }>(
      `SELECT id FROM rides WHERE ${ownerColumn}=$1 AND ($2::uuid IS NULL OR (created_at,id) < (SELECT created_at,id FROM rides WHERE id=$2 AND ${ownerColumn}=$1)) ORDER BY created_at DESC,id DESC LIMIT 21`,
      [actor.id, before ?? null],
    )
  ).rows;
  const hasMore = rows.length > 20;
  const page = rows.slice(0, 20);
  return {
    rides: await Promise.all(page.map((row) => getRide(pool, actor, row.id))),
    nextCursor: hasMore ? page.at(-1)!.id : null,
  };
}
