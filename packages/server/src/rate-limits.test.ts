import { transaction } from './transactions';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { Pool } from 'pg';
import { testDatabase } from '@rove/database/testing';
import { RequestLimiter } from './rate-limits';
let runtimePool: Pool;
let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  database = await testDatabase();
  await database.pool.query(
    "CREATE ROLE rls_limits LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'synthetic-local-only'",
  );
  await database.pool.query('GRANT USAGE ON SCHEMA public TO rls_limits');
  await database.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rls_limits');
  runtimePool = new Pool({
    host: '127.0.0.1',
    port: (await database.pool.query('SELECT inet_server_port() AS port')).rows[0].port,
    database: 'postgres',
    user: 'rls_limits',
    password: 'synthetic-local-only',
    max: 5,
  });
}, 60_000);
afterAll(async () => {
  await runtimePool?.end();
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE rate_limit_buckets');
});
test('concurrent instances cannot exceed one shared budget', async () => {
  const instances = [new RequestLimiter(runtimePool), new RequestLimiter(runtimePool)];
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
  const limiter = new RequestLimiter(runtimePool);
  for (let i = 0; i < 10; i++) await limiter.consume('fixture-a', 'quotes');
  await expect(limiter.consume('fixture-a', 'quotes')).rejects.toMatchObject({ status: 429 });
  await expect(limiter.consume('fixture-b', 'quotes')).resolves.toBeUndefined();
  await expect(limiter.consume('fixture-a', 'places')).resolves.toBeUndefined();
  await database.pool.query("UPDATE rate_limit_buckets SET expires_at=now()-interval '1 second'");
  await expect(limiter.consume('fixture-a', 'quotes')).resolves.toBeUndefined();
});
test('failed storage denies requests without exposing connection errors', async () => {
  const pool = {
    connect: vi.fn().mockRejectedValue(new Error('postgres://secret-password')),
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
  const limiter = new RequestLimiter(runtimePool);
  await limiter.consume('expired', 'quotes');
  await database.pool.query("UPDATE rate_limit_buckets SET expires_at=now()-interval '2 days'");
  await limiter.consume('active', 'quotes');
  expect(await limiter.prune()).toBe(1);
  expect((await database.pool.query('SELECT count(*) FROM rate_limit_buckets')).rows[0].count).toBe('1');
});

test('request scope cannot read other counters and maintenance cannot delete active counters', async () => {
  const limiter = new RequestLimiter(runtimePool);
  await limiter.consume('synthetic-a', 'quotes');
  await limiter.consume('synthetic-b', 'quotes');
  const keys = (await database.pool.query('SELECT key FROM rate_limit_buckets ORDER BY key')).rows;
  expect((await runtimePool.query('SELECT * FROM rate_limit_buckets')).rowCount).toBe(0);
  await transaction(runtimePool, async (c) => {
    await c.query("SELECT set_config('rove.rate_key',$1,true)", [keys[0].key]);
    expect((await c.query('SELECT * FROM rate_limit_buckets')).rowCount).toBe(1);
    expect(
      (await c.query('UPDATE rate_limit_buckets SET count=1 WHERE key=$1', [keys[1].key])).rowCount,
    ).toBe(0);
    expect((await c.query('DELETE FROM rate_limit_buckets')).rowCount).toBe(0);
  });
  await transaction(runtimePool, async (c) => {
    await c.query("SELECT set_config('rove.rate_prune','true',true)");
    expect((await c.query('SELECT * FROM rate_limit_buckets')).rowCount).toBe(0);
    expect((await c.query('DELETE FROM rate_limit_buckets')).rowCount).toBe(0);
  });
  expect((await runtimePool.query('SELECT * FROM rate_limit_buckets')).rowCount).toBe(0);
});
