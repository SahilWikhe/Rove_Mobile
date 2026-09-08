import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { Coordinate, DriverOffer, Quote, type Place } from '@rove/contracts';
import { transaction, event } from './transactions';
import type { MapsProvider } from './quotes';

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians; const dLon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
async function wake(client: PoolClient, rideId: string, at: Date, key: string) {
  await client.query("INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key,available_at) VALUES ('matching.tick',$1,'{}',$2,$3) ON CONFLICT DO NOTHING", [rideId, key, at]);
}
interface SearchRow { id: string; state: string; payment_state: string; search_deadline: Date; version: number; snapshot: unknown }
export class MatchingService {
  constructor(private pool: Pool, private maps: MapsProvider, private now: () => Date = () => new Date()) {}
  private async inspect(client: PoolClient, rideId: string): Promise<SearchRow | null> {
    const ride = (await client.query<SearchRow>('SELECT r.*,q.snapshot FROM rides r JOIN quotes q ON q.id=r.quote_id WHERE r.id=$1 FOR UPDATE OF r', [rideId])).rows[0];
    if (!ride || ride.state !== 'searching' || ride.payment_state !== 'authorized') return null;
    await client.query(`UPDATE offers o SET status='expired' FROM drivers d WHERE o.ride_id=$1 AND o.driver_id=d.id AND o.status='pending'
      AND (o.expires_at<=$2 OR d.online=false OR d.approved=false OR d.payout_ready=false OR d.eligibility_expires_at<=$2 OR d.location_at<$2::timestamptz-interval '60 seconds')`, [rideId, this.now()]);
    const count = (await client.query<{ count: number }>('SELECT count(*)::int AS count FROM offers WHERE ride_id=$1', [rideId])).rows[0]!.count;
    const pending = (await client.query<{ expires_at: Date }>("SELECT expires_at FROM offers WHERE ride_id=$1 AND status='pending'", [rideId])).rows[0];
    if (pending && ride.search_deadline > this.now()) return null;
    if (ride.search_deadline <= this.now() || count >= 8) {
      await client.query("UPDATE offers SET status='expired' WHERE ride_id=$1 AND status='pending'", [rideId]);
      await client.query("UPDATE rides SET state='no_driver_found',version=version+1,updated_at=now() WHERE id=$1", [rideId]);
      await event(client, rideId, 'ride.no_driver_found', null, ride.version + 1);
      return null;
    }
    return ride;
  }
  async tick(rideId: string): Promise<void> {
    const ride = await transaction(this.pool, client => this.inspect(client, rideId));
    if (!ride) return;
    const quote = Quote.parse(ride.snapshot);
    const candidates = (await this.pool.query<{ id: string; location: unknown }>(`SELECT d.id,d.location FROM drivers d JOIN users u ON u.id=d.id
      WHERE d.online=true AND d.approved=true AND d.payout_ready=true AND d.eligibility_expires_at>$1 AND u.disabled=false
      AND d.location_at>$1::timestamptz-interval '60 seconds' AND d.location IS NOT NULL
      AND ($2='standard' OR d.service='accessible')
      AND NOT EXISTS (SELECT 1 FROM offers WHERE driver_id=d.id AND (ride_id=$3 OR status='pending'))
      AND NOT EXISTS (SELECT 1 FROM rides WHERE driver_id=d.id AND state IN ('matched','en_route','arrived','in_progress','interrupted'))
      ORDER BY power((d.location->>'latitude')::double precision-$4::double precision,2)
        +power(((d.location->>'longitude')::double precision-$5::double precision)*cos(radians($4::double precision)),2) LIMIT 100`,
      [this.now(), quote.service, rideId, quote.pickup.coordinate.latitude, quote.pickup.coordinate.longitude])).rows;
    const nearby = candidates.flatMap(candidate => {
      const point = Coordinate.safeParse(candidate.location);
      if (!point.success) return [];
      const distance = distanceMeters(point.data, quote.pickup.coordinate);
      return distance <= 25_000 ? [{ id: candidate.id, coordinate: point.data, distance }] : [];
    }).sort((a, b) => a.distance - b.distance).slice(0, 5);
    // Directions calls occur outside database locks. Route results are revalidated before committing an offer.
    const ranked = (await Promise.all(nearby.map(async candidate => {
      const from: Place = { id: `driver:${candidate.id}`, label: 'Driver location', area: 'Driver area', coordinate: candidate.coordinate };
      try {
        const route = await this.maps.route(from, quote.pickup, quote.service);
        if (!Number.isSafeInteger(route.durationSeconds) || route.durationSeconds < 0 || route.durationSeconds > 1800) return null;
        return { ...candidate, seconds: route.durationSeconds };
      } catch { return null; }
    }))).filter(candidate => candidate !== null).sort((a, b) => a.seconds - b.seconds || a.id.localeCompare(b.id));
    await transaction(this.pool, async client => {
      if (!await this.inspect(client, rideId)) return;
      for (const candidate of ranked) {
        const current = (await client.query<{ location: unknown }>(`SELECT d.location FROM drivers d JOIN users u ON u.id=d.id
          WHERE d.id=$1 AND d.online=true AND d.approved=true AND d.payout_ready=true AND d.eligibility_expires_at>$2 AND u.disabled=false
          AND d.location_at>$2::timestamptz-interval '60 seconds' AND ($3='standard' OR d.service='accessible') FOR UPDATE OF d SKIP LOCKED`,
          [candidate.id, this.now(), quote.service])).rows[0];
        const point = Coordinate.safeParse(current?.location);
        if (!point.success || distanceMeters(point.data, candidate.coordinate) > 500) continue;
        const busy = await client.query(`SELECT id FROM offers WHERE driver_id=$1 AND (ride_id=$2 OR status='pending')
          UNION ALL SELECT id FROM rides WHERE driver_id=$1 AND state IN ('matched','en_route','arrived','in_progress','interrupted')`, [candidate.id, rideId]);
        if (busy.rowCount) continue;
        const offerId = randomUUID(); const expires = new Date(Math.min(this.now().getTime() + 20_000, ride.search_deadline.getTime()));
        const offer = DriverOffer.parse({ id: offerId, rideId, expiresAt: expires.toISOString(), pickupArea: quote.pickup.area,
          destinationArea: quote.destination.area, service: quote.service, pickupSeconds: candidate.seconds, tripSeconds: quote.durationSeconds,
          distanceMeters: quote.distanceMeters, estimatedEarnings: quote.estimatedDriverEarnings });
        await client.query('INSERT INTO offers(id,ride_id,driver_id,expires_at,snapshot) VALUES($1,$2,$3,$4,$5)', [offerId, rideId, candidate.id, expires, JSON.stringify(offer)]);
        await wake(client, rideId, expires, `offer-expiry:${offerId}`);
        await client.query("INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES('offer.created',$1,$2,$3)", [rideId, JSON.stringify({ driverId: candidate.id, offerId }), `offer-created:${offerId}`]);
        return;
      }
      const retry = new Date(Math.min(this.now().getTime() + 5000, ride.search_deadline.getTime()));
      await wake(client, rideId, retry, `search-retry:${rideId}:${Math.floor(retry.getTime() / 5000)}`);
    });
  }
}
