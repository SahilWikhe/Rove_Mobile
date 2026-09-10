import { z } from 'zod';
import { Place } from '@rove/contracts';
import type { MapsProvider, ServiceArea } from './quotes';
const Area = z
  .object({
    south: z.number().min(-90).max(90),
    north: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
    east: z.number().min(-180).max(180),
  })
  .strict()
  .refine((a) => a.south < a.north && a.west < a.east);
const Query = z.string().trim().min(3).max(150);
export class MapsReadinessError extends Error {
  constructor(readonly stage: string) {
    super(`Maps staging check failed at ${stage}.`);
  }
}
/** Up to five billable reads against public test locations; never books rides or touches the database. */
export async function inspectMapsStaging(
  env: Record<string, string | undefined>,
  queries: { pickup: string; destination: string },
  create: (key: string, area: ServiceArea) => MapsProvider,
  allowBillableRequests = false,
) {
  let stage = 'configuration';
  try {
    if (!allowBillableRequests || env.ROVE_ENVIRONMENT !== 'staging')
      throw new Error('Explicit staging opt-in required');
    const key = z.string().trim().min(1).parse(env.GOOGLE_MAPS_API_KEY);
    const area = Area.parse(JSON.parse(env.SERVICE_AREA_JSON ?? ''));
    const pickupQuery = Query.parse(queries.pickup),
      destinationQuery = Query.parse(queries.destination);
    const inside = (p: Place) =>
      p.coordinate.latitude >= area.south &&
      p.coordinate.latitude <= area.north &&
      p.coordinate.longitude >= area.west &&
      p.coordinate.longitude <= area.east;
    const provider = create(key, area);
    async function lookup(query: string, label: string) {
      stage = `${label} search`;
      const results = z.array(Place).parse(await provider.search(query));
      const selected = results.find(inside);
      if (!selected) throw new Error('No in-area result');
      stage = `${label} details`;
      const resolved = Place.parse(await provider.resolve(selected.id));
      if (resolved.id !== selected.id || !inside(resolved))
        throw new Error('Place changed or outside service area');
      return resolved;
    }
    const pickup = await lookup(pickupQuery, 'pickup');
    const destination = await lookup(destinationQuery, 'destination');
    stage = 'driving route';
    if (pickup.id === destination.id) throw new Error('Distinct public locations required');
    const route = z
      .object({
        distanceMeters: z.number().int().positive().max(10_000_000),
        durationSeconds: z.number().int().positive().max(10_000_000),
      })
      .parse(await provider.route(pickup, destination, 'standard'));
    return { distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds };
  } catch {
    // Never include provider messages, keys, addresses, or URLs in diagnostics.
    throw new MapsReadinessError(stage);
  }
}
