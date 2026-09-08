import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { Quote, type Place, type Service } from '@rove/contracts';
import { DomainError } from './errors';
import { priceRoute, type RatePolicy } from './pricing';
import type { Actor } from './rides';

export interface MapsProvider {
  route(
    pickup: Place,
    destination: Place,
    service: Service,
  ): Promise<{ distanceMeters: number; durationSeconds: number }>;
  search(query: string): Promise<Place[]>;
  resolve(id: string): Promise<Place>;
}
export interface ServiceArea {
  south: number;
  north: number;
  west: number;
  east: number;
}
export class QuoteService {
  constructor(
    private pool: Pool,
    private maps: MapsProvider,
    private rates: RatePolicy,
    private area: ServiceArea,
    private now: () => Date = () => new Date(),
  ) {}
  async create(actor: Actor, input: { pickup: Place; destination: Place; service: Service }) {
    if (actor.role !== 'rider') throw new DomainError('FORBIDDEN', 'Only riders can request a quote.', 403);
    // Resolve authoritative places. A client cannot relabel a provider place or move its coordinates.
    const [pickup, destination] = await Promise.all([
      this.maps.resolve(input.pickup.id),
      this.maps.resolve(input.destination.id),
    ]);
    for (const place of [pickup, destination]) {
      const { latitude, longitude } = place.coordinate;
      if (
        latitude < this.area.south ||
        latitude > this.area.north ||
        longitude < this.area.west ||
        longitude > this.area.east
      ) {
        throw new DomainError('OUTSIDE_SERVICE_AREA', 'This trip is outside the current service area.', 422);
      }
    }
    const route = await this.maps.route(pickup, destination, input.service);
    const price = priceRoute(route.distanceMeters, route.durationSeconds, this.rates);
    const quote = Quote.parse({
      id: randomUUID(),
      riderId: actor.id,
      pickup,
      destination,
      service: input.service,
      ...route,
      fare: { amount: price.fare, currency: 'USD' },
      estimatedDriverEarnings: { amount: price.driverEarnings, currency: 'USD' },
      rateVersion: price.rateVersion,
      expiresAt: new Date(this.now().getTime() + 120_000).toISOString(),
    });
    await this.pool.query('INSERT INTO quotes (id,rider_id,snapshot,expires_at) VALUES ($1,$2,$3,$4)', [
      quote.id,
      actor.id,
      JSON.stringify(quote),
      quote.expiresAt,
    ]);
    return quote;
  }
}
