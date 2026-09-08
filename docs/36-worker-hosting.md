# Vercel worker hosting

## Delivery path

Successful booking, offer, ride-transition, payment-session and Stripe-webhook requests publish a minimal `{ version: 1 }` wakeup after the response through `waitUntil`. Read requests, location heartbeats, rejected requests and unrelated POSTs do not publish. A publishing failure does not replace a committed booking response with an error: durable PostgreSQL jobs remain available for recovery.

`api/worker.ts` is a separate private queue-triggered function. Vercel's SDK obtains the delivered message and invokes `WorkerScheduling.consume`. The consumer validates its version, drains a bounded batch, and publishes the next delay calculated from database job availability/lease expiry. If follow-up publishing fails it throws, leaving delivery unacknowledged for retry. No rider, route, financial identifier or credential appears in the queue payload. Queue duplicates are acceptable; database leases and domain idempotency coordinate execution.

`GET /internal/recover` checks the exact bearer `CRON_SECRET` using constant-time comparison, sweeps abandoned searches, drains work and schedules continuation. Failures return a generic 503. The configured cron runs each minute to cover a process crash between database commit and publishing, lost wakeups, queue retention expiry and deployment turnover. It uses current deployment configuration; retained database jobs must remain backward compatible during rollout.

## Project settings

The API now uses separate Node serverless functions, with Hono inside the public function. This replaces the earlier single-function Hono preset. Use Root Directory `apps/api`, Framework Other, Node 24, the committed pnpm lockfile and `vercel.json`. Enable workspace access outside the root directory. Build runs `pnpm build`; static output is the empty `public` directory. Never publish the server's `dist` directory as static output.

The HTTP function has explicit rewrites for health, v1, tracking, webhooks and internal paths. The queue function has its own `queue/v2beta` trigger for `rove-worker-wake` and is not exposed by Hono routes. Both deployment and queue publishing use `iad1` to keep their regions consistent. Verify this choice against the Neon region during staging setup.

Set an independent random base64url `CRON_SECRET` of 32–128 characters for each environment. Vercel supplies the cron authorization header. Queue SDK authentication uses Vercel's identity; no queue token belongs in either mobile app. All existing database, OIDC, maps and Stripe environment requirements still apply.

Minute-level recovery requires a plan supporting that cron frequency. Cron does not automatically run for preview deployments: invoke the protected recovery endpoint explicitly in preview testing or supply a separate authorized scheduler. Never point a preview at the production database. Paid setup is deferred to final provisioning, as requested.

## Verification and limitations

Five tests cover delayed/idle continuation, failed publishing, rejected payloads, recovery ordering, exact authentication, safe errors and mutation wakeup behavior. The packaged smoke check loads both function bundles and serves a real local HTTP request through the Node adapter. Existing PostgreSQL worker tests cover leases, retry backoff, duplicate processing and expiration recovery.

Cloud build output must still confirm that the queue consumer is registered and private, path rewrites preserve API routing, cron executes, and queue messages reach the intended deployment. Exercise actual delayed delivery, crash recovery and webhook-to-worker processing against an isolated Neon branch before enabling real bookings. Local compilation and simulated queue tests do not prove those platform behaviors.

Monitoring, notification/review consumers, dead-letter redrive and real provider/device checks remain incomplete. This checkpoint does not enable production bookings or imply operational readiness.

References: [Vercel queue SDK](https://vercel.com/docs/queues/sdk), [queue consumer setup](https://vercel.com/docs/queues/quickstart), [cron configuration](https://vercel.com/docs/cron-jobs).
