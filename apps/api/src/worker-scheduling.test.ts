import { expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { WorkerScheduling } from './worker-scheduling';
import { createHostedApp } from './hosted-app';
const secret = 'fixture-secret-not-production-0000000000';
function setup() {
  const run = vi.fn(async () => ({ processed: 1, failed: 0, wakeAfterSeconds: 20 as number | null }));
  const sweep = vi.fn(async () => 1);
  const publish = vi.fn(async (_delay: number) => {});
  return {
    run,
    sweep,
    publish,
    scheduler: new WorkerScheduling({ drain: { run }, searchExpiry: { sweep } }, { publish }),
  };
}
test('publishes delayed continuation and leaves idle queues asleep', async () => {
  const { scheduler, run, publish } = setup();
  await scheduler.consume({ version: 1 });
  expect(publish).toHaveBeenCalledWith(20);
  run.mockResolvedValue({ processed: 0, failed: 0, wakeAfterSeconds: null });
  await scheduler.consume({ version: 1 });
  expect(publish).toHaveBeenCalledTimes(1);
});
test('publishing failure rejects delivery and malformed messages cannot trigger database work', async () => {
  const { scheduler, publish, run } = setup();
  publish.mockRejectedValue(new Error('transport failure'));
  await expect(scheduler.consume({ version: 1 })).rejects.toThrow('transport failure');
  await expect(scheduler.consume({ version: 1, rideId: 'injected' })).rejects.toThrow();
  expect(run).toHaveBeenCalledTimes(1);
});
test('recovery sweeps first and propagates worker failure for retry', async () => {
  const { scheduler, sweep, run, publish } = setup();
  run.mockImplementation(async () => {
    expect(sweep).toHaveBeenCalledOnce();
    throw new Error('database unavailable');
  });
  await expect(scheduler.recover()).rejects.toThrow('database unavailable');
  expect(publish).not.toHaveBeenCalled();
});
test('recovery requires exact authentication and never exposes provider failures', async () => {
  const { scheduler, run } = setup();
  const app = createHostedApp(new Hono(), scheduler, secret, () => {});
  for (const auth of ['', 'Bearer wrong', `Basic ${secret}`, `Bearer ${secret}x`]) {
    expect((await app.request('/internal/recover', { headers: { Authorization: auth } })).status).toBe(401);
  }
  expect(run).not.toHaveBeenCalled();
  const good = await app.request('/internal/recover', { headers: { Authorization: `Bearer ${secret}` } });
  expect(good.status).toBe(200);
  expect(good.headers.get('cache-control')).toBe('no-store');
  run.mockRejectedValue(new Error('SECRET_PROVIDER_DETAILS'));
  const failed = await app.request('/internal/recover', { headers: { Authorization: `Bearer ${secret}` } });
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('SECRET_PROVIDER_DETAILS');
  expect(() => createHostedApp(new Hono(), scheduler, '', () => {})).toThrow();
});
test('only successful mutations wake work; publish failure preserves committed HTTP response', async () => {
  const { scheduler, publish } = setup();
  const api = new Hono()
    .post('/v1/ride-requests', (c) => c.json({ committed: true }, 201))
    .post('/v1/offers/fixture/accept', (c) => c.json({ error: 'invalid' }, 400))
    .post('/v1/drivers/me/heartbeat', (c) => c.json({ ok: true }))
    .get('/v1/read', (c) => c.json({ ok: true }))
    .post('/webhooks/stripe', (c) => c.json({ received: true }));
  const work: Promise<unknown>[] = [];
  const app = createHostedApp(api, scheduler, secret, (promise) => work.push(promise));
  await app.request('/v1/read');
  await app.request('/v1/drivers/me/heartbeat', { method: 'POST' });
  await app.request('/v1/offers/fixture/accept', { method: 'POST' });
  expect(publish).not.toHaveBeenCalled();
  publish.mockRejectedValue(new Error('queue unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await app.request('/v1/ride-requests', { method: 'POST' });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ committed: true });
    await app.request('/webhooks/stripe', { method: 'POST' });
    await Promise.all(work);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith(0);
  } finally {
    log.mockRestore();
  }
});

test('recovery refreshes payout accounts before draining their durable jobs', async () => {
  const order: string[] = [];
  const scheduler = new WorkerScheduling(
    {
      searchExpiry: {
        sweep: async () => {
          order.push('search');
          return 0;
        },
      },
      payoutReconciliation: {
        sweep: async () => {
          order.push('payout');
          return 1;
        },
      },
      drain: {
        run: async () => {
          order.push('drain');
          return { processed: 1, failed: 0, wakeAfterSeconds: null };
        },
      },
    },
    {
      publish: async () => {
        throw new Error('No continuation needed');
      },
    },
  );
  await scheduler.recover();
  expect(order).toEqual(['search', 'payout', 'drain']);
});
test('successful Connect notifications and onboarding mutations wake the worker, reads do not', async () => {
  const { scheduler, publish } = setup();
  const work: Promise<unknown>[] = [];
  const api = new Hono()
    .post('/webhooks/stripe-connect', (c) => c.json({ received: true }))
    .post('/v1/drivers/me/payout-setup', (c) => c.json({ ok: true }))
    .get('/v1/drivers/me/payout-setup', (c) => c.json({ status: 'pending' }));
  const app = createHostedApp(api, scheduler, secret, (p) => work.push(p));
  await app.request('/v1/drivers/me/payout-setup');
  expect(publish).not.toHaveBeenCalled();
  await app.request('/webhooks/stripe-connect', { method: 'POST' });
  await app.request('/v1/drivers/me/payout-setup', { method: 'POST' });
  await Promise.all(work);
  expect(publish).toHaveBeenCalledTimes(2);
});
