import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { QuoteRequest, RideState, Coordinate, Heartbeat, BackgroundLocation } from '@rove/contracts';
import {
  DomainError,
  RequestLimiter,
  RateLimitError,
  type RequestLimit,
  TrackingService,
  DriverService,
  RideService,
  QuoteService,
  capabilities,
  type Actor,
  type MapsProvider,
} from '@rove/server';
import type { Pool } from 'pg';
import type { VerifyIdentity } from './auth';
import { getReceipt } from './receipt-queries';
import { getRide, listRides } from './ride-queries';

type Environment = { Variables: { actor: Actor; subject: string; requestId: string } };
interface Dependencies {
  pool: Pool;
  verifyIdentity: VerifyIdentity;
  rides: RideService;
  quotes: QuoteService;
  maps: MapsProvider;
  flags: () => Promise<{ scheduling: boolean; weekly: boolean; monthly: boolean }>;
  allowedOrigins?: string[];
  paymentSessions?: {
    create(actor: Actor, rideId: string): Promise<{ rideId: string; clientSecret: string }>;
  };
  paymentWebhooks?: { receive(body: Buffer, signature: string): Promise<void> };
}
const Id = z.uuid();
async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json'))
    throw new DomainError('INVALID_BODY', 'Send a JSON request.', 400);
  try {
    return schema.parse(await c.req.json());
  } catch {
    throw new DomainError('INVALID_BODY', 'Check the request fields and try again.', 400);
  }
}
function id(value: string): string {
  const parsed = Id.safeParse(value);
  if (!parsed.success) throw new DomainError('INVALID_ID', 'Invalid resource identifier.', 400);
  return parsed.data;
}
export function createApp(deps: Dependencies) {
  const app = new Hono<Environment>();
  const limiter = new RequestLimiter(deps.pool);
  const drivers = new DriverService(deps.pool);
  const tracking = new TrackingService(deps.pool);
  if (deps.allowedOrigins?.length)
    app.use(
      '*',
      cors({
        origin: deps.allowedOrigins,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      }),
    );
  app.use('*', async (c, next) => {
    c.set('requestId', randomUUID());
    c.header('X-Request-ID', c.var.requestId);
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.use('*', secureHeaders());
  app.use('*', (c, next) =>
    bodyLimit({
      maxSize: c.req.path === '/webhooks/stripe' ? 1_048_576 : 32_768,
      onError: (c) =>
        c.json(
          { error: { code: 'BODY_TOO_LARGE', message: 'Request is too large.', requestId: c.var.requestId } },
          413,
        ),
    })(c, next),
  );
  app.onError((error, c) => {
    const known = error instanceof DomainError;
    if (error instanceof RateLimitError) c.header('Retry-After', String(error.retryAfterSeconds));
    return c.json(
      {
        error: {
          code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : 'Something went wrong. Please try again.',
          requestId: c.var.requestId,
        },
      },
      known ? error.status : 500,
    );
  });
  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.', requestId: c.var.requestId } }, 404),
  );
  app.get('/health/live', (c) => c.json({ status: 'ok' }));
  app.post('/webhooks/stripe', async (c) => {
    if (!deps.paymentWebhooks)
      throw new DomainError('PAYMENTS_UNAVAILABLE', 'Payment events are not configured.', 503);
    const signature = c.req.header('stripe-signature') ?? '';
    if (!signature || signature.length > 8192)
      throw new DomainError('INVALID_PAYMENT_WEBHOOK', 'Invalid payment event.', 400);
    await deps.paymentWebhooks.receive(Buffer.from(await c.req.arrayBuffer()), signature);
    return c.json({ received: true });
  });
  // These routes authenticate a location-only grant, never an account bearer token.
  function trackingToken(c: Context) {
    const match = /^Bearer (rt_[A-Za-z0-9_-]{43})$/.exec(c.req.header('Authorization') ?? '');
    if (!match?.[1])
      throw new DomainError('TRACKING_UNAUTHORIZED', 'Open the driver app to reconnect location.', 401);
    return match[1];
  }
  app.post('/tracking/v1/location', async (c) =>
    c.json(await tracking.location(trackingToken(c), await body(c, BackgroundLocation))),
  );
  app.delete('/tracking/v1/session', async (c) => c.json(await tracking.revoke(trackingToken(c))));
  app.use('/v1/*', async (c, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(c.req.header('Authorization') ?? '');
    if (!match?.[1] || match[1].length > 16_384)
      throw new DomainError('UNAUTHENTICATED', 'Please sign in.', 401);
    const identity = await deps.verifyIdentity(match[1]);
    c.set('subject', identity.subject);
    let policy: RequestLimit = c.req.method === 'GET' ? 'read' : 'mutation';
    if (c.req.path === '/v1/places') policy = 'places';
    else if (c.req.path === '/v1/quotes') policy = 'quotes';
    else if (c.req.method === 'POST' && /^\/v1\/rides\/[^/]+\/payment-session$/.test(c.req.path))
      policy = 'paymentSessions';
    else if (c.req.path === '/v1/me' && c.req.method === 'POST') policy = 'signup';
    else if (c.req.path === '/v1/drivers/me/tracking-session') policy = 'trackingGrant';
    else if (c.req.path === '/v1/drivers/me/heartbeat') policy = 'heartbeat';
    await limiter.consume(identity.subject, policy);
    const result = await deps.pool.query<{ id: string; role: Actor['role']; disabled: boolean }>(
      'SELECT id,role,disabled FROM users WHERE subject=$1',
      [identity.subject],
    );
    const user = result.rows[0];
    if (user?.disabled)
      throw new DomainError('ACCOUNT_DISABLED', 'Contact support for help with your account.', 403);
    if (user) c.set('actor', { id: user.id, role: user.role });
    else if (!(c.req.path === '/v1/me' && c.req.method === 'POST'))
      throw new DomainError('PROFILE_REQUIRED', 'Complete your profile to continue.', 403);
    await next();
  });
  app.post('/v1/me', async (c) => {
    const input = await body(
      c,
      z.object({ name: z.string().trim().min(1).max(100), role: z.enum(['rider', 'driver']) }).strict(),
    );
    // Public signup can never grant staff access or driver approval.
    const result = await deps.pool.query<{ id: string; role: Actor['role']; name: string }>(
      'INSERT INTO users (subject,name,role) VALUES ($1,$2,$3) ON CONFLICT (subject) DO UPDATE SET subject=EXCLUDED.subject RETURNING id,role,name',
      [c.var.subject, input.name, input.role],
    );
    const user = result.rows[0]!;
    if (user.role === 'driver')
      await deps.pool.query('INSERT INTO drivers (id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
    return c.json(user);
  });
  app.get('/v1/me', async (c) => {
    const user = (await deps.pool.query('SELECT id,name,role FROM users WHERE id=$1', [c.var.actor.id]))
      .rows[0];
    return c.json(user);
  });
  app.get('/v1/me/capabilities', async (c) => {
    let flags = { scheduling: false, weekly: false, monthly: false };
    try {
      flags = await deps.flags();
    } catch {
      /* New feature access fails closed. */
    }
    return c.json(capabilities(flags, new Date()));
  });
  app.get('/v1/places', async (c) => {
    const q = c.req.query('q')?.trim() ?? '';
    if (q.length < 3 || q.length > 150)
      throw new DomainError('INVALID_QUERY', 'Enter at least three characters.', 400);
    return c.json({ places: await deps.maps.search(q) });
  });
  app.post('/v1/quotes', async (c) =>
    c.json(await deps.quotes.create(c.var.actor, await body(c, QuoteRequest)), 201),
  );
  app.post('/v1/drivers/me/tracking-session', async (c) => {
    await body(c, z.object({}).strict());
    return c.json(await tracking.issue(c.var.actor), 201);
  });
  app.get('/v1/drivers/me', async (c) => c.json(await drivers.profile(c.var.actor)));
  app.put('/v1/drivers/me/availability', async (c) => {
    const input = await body(
      c,
      z.object({ online: z.boolean(), coordinate: Coordinate.optional() }).strict(),
    );
    return c.json(
      await drivers.availability(
        c.var.actor,
        input.online,
        input.coordinate,
        c.req.header('Idempotency-Key') ?? '',
      ),
    );
  });
  app.post('/v1/drivers/me/heartbeat', async (c) =>
    c.json(await drivers.heartbeat(c.var.actor, await body(c, Heartbeat))),
  );
  app.get('/v1/drivers/me/offers', async (c) => c.json(await drivers.offers(c.var.actor)));
  app.post('/v1/offers/:id/decline', async (c) => {
    await body(c, z.object({}).strict());
    return c.json(
      await drivers.decline(c.var.actor, id(c.req.param('id')), c.req.header('Idempotency-Key') ?? ''),
    );
  });
  app.get('/v1/rides', async (c) =>
    c.json(
      await listRides(deps.pool, c.var.actor, c.req.query('before') ? id(c.req.query('before')!) : undefined),
    ),
  );
  app.get('/v1/rides/:id', async (c) => c.json(await getRide(deps.pool, c.var.actor, id(c.req.param('id')))));
  app.post('/v1/ride-requests', async (c) => {
    const input = await body(c, z.object({ quoteId: Id }).strict());
    return c.json(
      await deps.rides.request(c.var.actor, input.quoteId, c.req.header('Idempotency-Key') ?? ''),
      201,
    );
  });
  app.post('/v1/offers/:id/accept', async (c) => {
    await body(c, z.object({}).strict());
    return c.json(
      await deps.rides.accept(c.var.actor, id(c.req.param('id')), c.req.header('Idempotency-Key') ?? ''),
    );
  });
  app.get('/v1/rides/:id/receipt', async (c) =>
    c.json(await getReceipt(deps.pool, c.var.actor, id(c.req.param('id')))),
  );
  app.post('/v1/rides/:id/payment-session', async (c) => {
    await body(c, z.object({}).strict());
    if (!deps.paymentSessions)
      throw new DomainError('PAYMENTS_UNAVAILABLE', 'Payments are not configured.', 503);
    return c.json(await deps.paymentSessions.create(c.var.actor, id(c.req.param('id'))));
  });
  app.post('/v1/rides/:id/transitions', async (c) => {
    const input = await body(
      c,
      z.object({ state: RideState, expectedVersion: z.number().int().positive() }).strict(),
    );
    return c.json(
      await deps.rides.transition(
        c.var.actor,
        id(c.req.param('id')),
        input.state,
        input.expectedVersion,
        c.req.header('Idempotency-Key') ?? '',
      ),
    );
  });
  return app;
}
