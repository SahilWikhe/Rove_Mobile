import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, users, drivers, quotes, rides } from './index';

let postgres: EmbeddedPostgres;
let database: ReturnType<typeof createDatabase>;
beforeAll(async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  postgres = new EmbeddedPostgres({ databaseDir: await mkdtemp(join(tmpdir(), 'rove-postgres-')), port,
    user: 'rove_test', password: 'local-fixture-only', persistent: false });
  await postgres.initialise();
  await postgres.start();
  database = createDatabase(`postgresql://rove_test:local-fixture-only@127.0.0.1:${port}/postgres`);
  await migrate(database.db, { migrationsFolder: './migrations' });
}, 60_000);
afterAll(async () => { await database?.pool.end(); await postgres?.stop(); });
beforeEach(async () => { await database.pool.query('TRUNCATE users CASCADE'); });

async function fixture() {
  const riderId = randomUUID(); const driverId = randomUUID(); const quoteId = randomUUID();
  await database.db.insert(users).values([
    { id: riderId, subject: riderId, name: 'Synthetic rider', role: 'rider' },
    { id: driverId, subject: driverId, name: 'Synthetic driver', role: 'driver' },
  ]);
  await database.db.insert(drivers).values({ id: driverId });
  await database.db.insert(quotes).values({ id: quoteId, riderId, snapshot: {}, expiresAt: new Date(Date.now() + 60_000) });
  return { riderId, driverId, quoteId, fareCents: 700, earningsCents: 550, searchDeadline: new Date(Date.now() + 60_000) };
}
test('competing inserts cannot create two active rides for the same rider', async () => {
  const values = await fixture(); const secondQuote = randomUUID();
  await database.db.insert(quotes).values({ id: secondQuote, riderId: values.riderId, snapshot: {}, expiresAt: new Date() });
  const results = await Promise.allSettled([
    database.db.insert(rides).values(values),
    database.db.insert(rides).values({ ...values, quoteId: secondQuote }),
  ]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect((await database.db.select().from(rides))).toHaveLength(1);
});
test('a driver cannot be assigned to simultaneous active rides', async () => {
  const first = await fixture(); const second = await fixture();
  await database.db.insert(rides).values({ ...first, state: 'matched' });
  await expect(database.db.insert(rides).values({ ...second, driverId: first.driverId, state: 'matched' })).rejects.toThrow();
});
test('money and foreign keys remain protected when bypassing the application', async () => {
  const values = await fixture();
  await expect(database.db.insert(rides).values({ ...values, fareCents: -1 })).rejects.toThrow();
  await expect(database.db.insert(rides).values({ ...values, riderId: randomUUID() })).rejects.toThrow();
});
test('a completed ride does not prevent a new request', async () => {
  const values = await fixture(); const quoteId = randomUUID();
  await database.db.insert(rides).values({ ...values, state: 'completed' });
  await database.db.insert(quotes).values({ id: quoteId, riderId: values.riderId, snapshot: {}, expiresAt: new Date() });
  await database.db.insert(rides).values({ ...values, quoteId });
  expect(await database.db.select().from(rides)).toHaveLength(2);
});
