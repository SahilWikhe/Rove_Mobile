import { timingSafeEqual } from 'node:crypto';
import { Hono, type Env } from 'hono';
import type { WorkerScheduling } from './worker-scheduling';
export function createHostedApp<E extends Env>(
  api: Hono<E>,
  scheduler: Pick<WorkerScheduling, 'wake' | 'recover'>,
  secret: string,
  background: (work: Promise<unknown>) => void,
) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(secret)) throw new Error('A strong CRON_SECRET is required.');
  const app = new Hono();
  app.use('*', async (c, next) => {
    await next();
    const createsWork =
      c.req.path === '/webhooks/stripe' ||
      c.req.path === '/webhooks/stripe-connect' ||
      c.req.path === '/v1/drivers/me/payout-setup' ||
      c.req.path === '/v1/ride-requests' ||
      /^\/v1\/offers\/[^/]+\/(accept|decline)$/.test(c.req.path) ||
      /^\/v1\/rides\/[^/]+\/(payment-session|transitions)$/.test(c.req.path);
    if (c.req.method === 'POST' && createsWork && c.res.status >= 200 && c.res.status < 300) {
      background(
        scheduler.wake().catch(() => {
          // The database commit already succeeded. Recovery cron covers this publishing failure.
          console.error('Worker wakeup failed; durable jobs await recovery.');
        }),
      );
    }
  });
  app.get('/internal/recover', async (c) => {
    c.header('Cache-Control', 'no-store');
    const actual = Buffer.from(c.req.header('Authorization') ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return c.json({ error: 'Unauthorized' }, 401);
    try {
      const result = await scheduler.recover();
      return c.json(result);
    } catch {
      return c.json({ error: 'Worker recovery unavailable' }, 503);
    }
  });
  app.route('/', api);
  return app;
}
