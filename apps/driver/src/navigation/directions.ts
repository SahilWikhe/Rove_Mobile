import { Coordinate, type RideDetails } from '@rove/contracts';

export function navigationTarget(ride: RideDetails) {
  const leg =
    ride.state === 'in_progress'
      ? 'destination'
      : ['matched', 'en_route', 'arrived'].includes(ride.state)
        ? 'pickup'
        : null;
  if (!leg) return null;
  const coordinate = Coordinate.safeParse(ride[leg]?.coordinate);
  if (!coordinate.success) return null;
  const point = `${coordinate.data.latitude},${coordinate.data.longitude}`;
  return {
    leg,
    point,
    url: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(point)}&travelmode=driving&dir_action=navigate`,
  };
}

/** A fresh owned-trip read is required for every explicit external handoff. */
export async function openTripDirections(options: {
  expected: RideDetails;
  signal: AbortSignal;
  load: (id: string, signal: AbortSignal) => Promise<RideDetails>;
  open: (url: string) => Promise<unknown>;
}) {
  const { expected, signal, load, open } = options;
  if (signal.aborted) return;
  const target = navigationTarget(expected);
  if (!target) throw new Error('Directions are not available for this trip.');
  const latest = await load(expected.id, signal);
  if (signal.aborted) return;
  const next = navigationTarget(latest);
  if (
    latest.id !== expected.id ||
    latest.version < expected.version ||
    !next ||
    next.leg !== target.leg ||
    next.point !== target.point
  )
    throw new Error('Your trip changed. Check the updated trip before opening directions again.');
  await open(next.url);
}
