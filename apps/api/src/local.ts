/** Disposable local integration environment. Never imported by the production entrypoint. */
import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { testDatabase } from '@rove/database/testing';
import { users, drivers } from '@rove/database';
import { DomainError, MatchingService, OutboxWorker, QuoteService, RideService, developmentRates, type MapsProvider } from '@rove/server';
import { createApp } from './app';
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw new Error('The synthetic server cannot run in a deployment.');
const database = await testDatabase();
const places = [
  { id: 'synthetic-home', label: 'Home · synthetic pickup', area: 'Downtown Raleigh', coordinate: { latitude: 35.7796, longitude: -78.6382 } },
  { id: 'synthetic-work', label: 'Work · synthetic destination', area: 'North Hills', coordinate: { latitude: 35.8365, longitude: -78.6427 } },
];
const maps: MapsProvider = {
  search: async query => places.filter(place => `${place.label} ${place.area}`.toLowerCase().includes(query.toLowerCase())),
  resolve: async id => { const place = places.find(place => place.id === id); if (!place) throw new DomainError('PLACE_NOT_FOUND', 'Select a synthetic place from search.', 404); return place; },
  route: async pickup => ({ durationSeconds: pickup.id.startsWith('driver:') ? 180 : 720, distanceMeters: pickup.id.startsWith('driver:') ? 1200 : 6500 }),
};
for (const role of ['rider', 'driver'] as const) {
  const id = randomUUID(); await database.db.insert(users).values({ id, subject: `synthetic-${role}`, role, name: role === 'rider' ? 'Alex Rider' : 'Jordan Driver' });
  if (role === 'driver') await database.db.insert(drivers).values({ id, approved: true, payoutReady: true, eligibilityExpiresAt: new Date(Date.now() + 86_400_000), vehicle: { make: 'Synthetic', model: 'Test vehicle', color: 'Black', plate: 'DEMO' } });
}
const matching = new MatchingService(database.pool, maps);
const worker = new OutboxWorker(database.pool, {
  'ride.requested': async job => { await database.pool.query("UPDATE rides SET payment_state='authorized' WHERE id=$1 AND state='searching' AND payment_state='pending'", [job.aggregateId]); await matching.tick(job.aggregateId); },
  'matching.tick': async job => matching.tick(job.aggregateId),
  'offer.created': async () => {}, // Local apps poll the real offer table; no external notifications.
  'ride.matched': async () => {}, 'ride.en_route': async () => {}, 'ride.arrived': async () => {}, 'ride.in_progress': async () => {},
  'ride.interrupted': async () => {},
  'ride.completed': async job => { await database.pool.query("UPDATE rides SET payment_state='paid' WHERE id=$1 AND state='completed'", [job.aggregateId]); },
  'ride.cancelled': async job => { await database.pool.query("UPDATE rides SET payment_state='released' WHERE id=$1 AND state='cancelled'", [job.aggregateId]); },
  'ride.no_driver_found': async job => { await database.pool.query("UPDATE rides SET payment_state='released' WHERE id=$1 AND state='no_driver_found'", [job.aggregateId]); },
});
const app = createApp({ pool: database.pool, maps, quotes: new QuoteService(database.pool, maps, developmentRates, { south: 35, north: 37, west: -80, east: -77 }), rides: new RideService(database.pool),
  flags: async () => ({ scheduling: false, weekly: false, monthly: false }),
  verifyIdentity: async token => { if (!['synthetic-rider', 'synthetic-driver'].includes(token)) throw new DomainError('UNAUTHENTICATED', 'Invalid local test identity.', 401); return { subject: token }; },
  allowedOrigins: ['http://localhost:8081', 'http://localhost:8082', 'http://localhost:8083'],
});
const server = serve({ fetch: app.fetch, port: 4080, hostname: '127.0.0.1' });
let stopped = false; let timer: ReturnType<typeof setTimeout>;
async function processJobs() { try { await worker.runOnce(20); } catch { console.error('Local worker failed; will retry.'); } finally { if (!stopped) timer = setTimeout(processJobs, 500); } }
void processJobs();
console.log('Synthetic Rove API: http://localhost:4080. Disposable data; no real payments or notifications.');
async function stop() { stopped = true; clearTimeout(timer); server.close(); await database.close(); process.exit(0); }
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
