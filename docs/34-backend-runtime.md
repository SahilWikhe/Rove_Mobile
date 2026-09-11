# Backend runtime and deployment boundary

## Implemented composition

`apps/api/index.ts` composes the Hono HTTP application; `apps/api/src/http-function.ts` adapts it to a Node serverless function. The deployed `apps/api/api/index.mjs` entrypoint imports the esbuild-generated `dist/http-function.mjs` bundle with an explicit extension; build verification imports this same deployed entrypoint to catch startup/module-resolution failures. It constructs one runtime per module instance and exports the application without listening on a port, starting polling timers, seeding fixtures or migrating the database. The runtime uses the existing Google Places/Routes adapter, signed OIDC verification, PostgreSQL pool and Stripe adapter. Rider payment sessions automatically provision the server-owned customer binding. Webhook ingress persists reconciliation work rather than trusting webhook payment state.

`src/runtime.ts` separates composition from resource creation. HTTP and worker hosts share the same domain services and configuration. `createRuntime` only constructs real adapters; synthetic identities/maps/payments are confined to `src/local.ts`. `composeRuntime` accepts explicit resources so integration tests can exercise the complete wiring against disposable PostgreSQL without reaching cloud accounts.

The returned worker consumes payment reconciliation, capture/release, terminal ride events and matching ticks. A ride request never sets its own payment authorization. Notification and financial-review topics have no production consumers yet; they remain visible dead letters rather than being acknowledged by empty callbacks.

## Configuration

Start from `apps/api/.env.example`. API configuration requires a TLS-verified PostgreSQL URL, OIDC issuer/audience/JWKS endpoint, Google Maps server key, explicit rate policy and service area. Browser origins are empty by default. Scheduling capabilities remain off.

Runtime payment settings additionally require:

- `STRIPE_ACCOUNT_ID`: the platform account owning the intents and webhook endpoint.
- `STRIPE_MODE`: `test` for preview/staging or `live` for production.
- `STRIPE_SECRET_KEY`: matching restricted/server key; never a mobile publishable key.
- `STRIPE_WEBHOOK_SECRET`: the endpoint signing secret for that account/environment.
- `STRIPE_PAYMENT_METHOD_CONFIGURATION`: dedicated dashboard configuration for supported manual-capture payment methods.

The payment source combines the account and mode. Mismatched key/mode or live/test deployment crossover fails before resource creation. Production also requires an explicitly approved rate-policy version. Validation errors include field names only. The runtime does not auto-discover which Stripe account a key belongs to: verify account, webhook endpoint and payment-method configuration together during sandbox setup.

## Vercel project setup, when infrastructure is ready

Use the existing `Rove_Mobile` repository and a dedicated API project. Set Root Directory to `apps/api`, use the Other framework preset and Node 24, and permit access to workspace files outside the root directory. Use pnpm with the committed lockfile. The package's `build` command compiles the backend; use the configured empty `public` output directory. `vercel.json` declares separate public HTTP and private queue functions; the server bundle is never exposed as static content.

The public function uses the Hono Node request adapter. The original single-function Hono preset was replaced to isolate the private queue consumer; see [worker hosting](36-worker-hosting.md). Route `/webhooks/stripe` is the payment webhook endpoint. `/health/live` proves that the HTTP process is alive; it does not claim that database, credentials, migrations or workers are ready.

Keep preview/staging databases and test payment credentials separate from production. The existing Neon project can supply an isolated development branch. Apply reviewed migrations as a separate controlled operation, using migration credentials; the runtime must use a restricted database role. No migration belongs in Vercel build/startup.

This configuration has not yet been built or deployed by Vercel. Local bundling is evidence of Node/module compatibility, not proof of Vercel packaging, credentials or live connectivity.

## Worker and launch gaps

The exported worker must be driven by a reliable host with repeated delivery and delayed wakeups. It is intentionally not started as an untracked timer in the HTTP function. Vercel deployment alone does not run this worker. Queue wakeup and protected recovery integration are now configured; deployment verification, worker monitoring, notification/review consumers and dead-letter recovery remain required before real bookings are enabled.

Searches abandoned before payment now have durable expiration jobs and a bounded recovery sweep; see [search expiration](35-search-expiration.md). Reliable worker delivery and periodic sweep invocation must be configured before launch.

Provider verification, native-device payment testing, driver payout integration, accounting corrections and the remaining product features are still outstanding. Do not present this checkpoint as a launch-ready backend.

## Verification

Four runtime tests cover required secret-safe configuration, environment separation, real-adapter initialization with rejected synthetic identity, and the composed booking → customer/payment session → webhook reconciliation → authorization → cancellation → release path. The latter uses real PostgreSQL and simulated provider boundaries; real Stripe signature verification has its own existing tests.

`pnpm --filter @rove/api build` bundles server code for Node 24 and rejects embedded PostgreSQL or the local synthetic entrypoint in the dependency graph. `pnpm --filter @rove/api verify:build` starts the bundle in a child process with an explicit fixture-only environment and verifies health, no-store, rejected synthetic identity and unknown routes. Both commands run in CI's required quality job. They never read ambient provider credentials or connect to the production database.

## Bounded worker invocations

The runtime now exposes `drain.run()`, which processes at most ten jobs and checks a twenty-second budget between jobs. In-flight provider requests retain their own timeouts; the budget is not a hard interruption deadline. Its result reports processed/failed counts and the next wakeup delay from persisted availability and lease expiry. Completed/dead-letter work is excluded. A future queue callback should publish that wakeup and propagate publishing failures; a periodic recovery trigger must cover a crash between database commit and publishing.

Three real PostgreSQL tests cover bounded batches, delayed work, crashed-worker lease recovery, slow-job budgets and retry backoff. Vercel queue publishing/callbacks and recovery cron are now wired in code; their cloud delivery verification is still outstanding.
