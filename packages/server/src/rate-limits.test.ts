import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
import { testDatabase } from '@rove/database/testing';
import { RequestLimiter } from './rate-limits';
let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  database = await testDatabase();
}, 60_000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE rate_limit_buckets');
});
test('concurrent instances cannot exceed one shared budget', async () => {
  const instances = [new RequestLimiter(database.pool), new RequestLimiter(database.pool)];
  const outcomes = await Promise.allSettled(
    Array.from({ length: 25 }, (_, i) => instances[i % 2]!.consume('fixture-user', 'quotes')),
  );
  expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(10);
  for (const outcome of outcomes)
    if (outcome.status === 'rejected')
      expect(outcome.reason).toMatchObject({
        code: 'RATE_LIMITED',
        status: 429,
        retryAfterSeconds: expect.any(Number),
      });
  expect((await database.pool.query('SELECT count FROM rate_limit_buckets')).rows[0].count).toBe(11);
});
test('expiration resets the window and identity/policy budgets stay separate', async () => {
  const limiter = new RequestLimiter(database.pool);
  for (let i = 0; i < 10; i++) await limiter.consume('fixture-a', 'quotes');
  await expect(limiter.consume('fixture-a', 'quotes')).rejects.toMatchObject({ status: 429 });
  await expect(limiter.consume('fixture-b', 'quotes')).resolves.toBeUndefined();
  await expect(limiter.consume('fixture-a', 'places')).resolves.toBeUndefined();
  await database.pool.query("UPDATE rate_limit_buckets SET expires_at=now()-interval '1 second'");
  await expect(limiter.consume('fixture-a', 'quotes')).resolves.toBeUndefined();
});
test('failed storage denies requests without exposing connection errors', async () => {
  const pool = {
    query: vi.fn().mockRejectedValue(new Error('postgres://secret-password')),
  } as unknown as Pool;
  await expect(new RequestLimiter(pool).consume('fixture-a', 'quotes')).rejects.toMatchObject({
    code: 'RATE_LIMIT_UNAVAILABLE',
    status: 503,
  });
  await expect(new RequestLimiter(pool).consume('fixture-a', 'quotes')).rejects.not.toThrow(
    'secret-password',
  );
});
test('cleanup removes only long-expired counters and preserves active windows', async () => {
  const limiter = new RequestLimiter(database.pool);
  await limiter.consume('expired', 'quotes');
  await database.pool.query("UPDATE rate_limit_buckets SET expires_at=now()-interval '2 days'");
  await limiter.consume('active', 'quotes');
  expect(await limiter.prune()).toBe(1);
  expect((await database.pool.query('SELECT count(*) FROM rate_limit_buckets')).rows[0].count).toBe('1');
});
