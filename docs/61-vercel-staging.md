# Vercel staging

Updated: September 12, 2026.

## Scope and current state

The separate `rove-api-staging` project in `team-7536` (`team_lNgElVK3RUXfpIY43YCvpbCS`) is deployed and Git-connected to `Rove_Mobile` main. Project ID: `prj_rLOcpNrXI7eftPgzzRebQbgfCkMC`. The marketing project remains separate. [Open staging project](https://vercel.com/team-7536/rove-api-staging).

On September 12, the stable alias [rove-api-staging.vercel.app](https://rove-api-staging.vercel.app) resolved to READY deployment `dpl_38Me36WZxPomkGGw4Bv7tjp7XwEZ`, source `31f7e42199448b4686be82a3e9738947752b324d` on main. This is a point-in-time read, not proof of every provider journey or the next deployment's health.

## Project settings and release boundary

- Root directory: `apps/api`, with shared workspace files available outside that root.
- Framework: Other; Node.js 24.x; frozen pnpm install; build `pnpm build`; static output `public`.
- Runtime/queue region: `iad1`, as defined in `apps/api/vercel.json`. Neon provider staging is in AWS US East 2; these regions are not identical.
- Main pushes can automatically deploy staging independently of GitHub CI. Check exact-source CI and deployment separately.
- Vercel's **Production target here is logical staging**, using `ROVE_ENVIRONMENT=staging` and sandbox payments. Do not add real production data or live Stripe credentials to this project.
- Preview deployments need explicitly isolated credentials/data; never assume they inherit safe staging isolation automatically.

## Environment readiness

Runtime configuration is installed for provider staging: restricted pooled database access, Auth0 OIDC, server Maps, Stripe sandbox and worker configuration. Realtime additionally uses `REALTIME_DATABASE_URL`, a direct connection to the same database and restricted role. See [provider handoff](62-provider-setup-handoff.md), [Neon setup](60-neon-staging.md) and [realtime](realtime-messaging.md). `apps/api/.env.example` and the runtime validators are the authoritative variable inventory.

The original ignored `.env.vercel.staging.partial` was a provisioning artifact, not a current deployable configuration or evidence that Vercel lacks variables. Never print or commit secret values. GitHub provider-check secrets are separate from Vercel environment variables. Native Maps keys and the rider publishable Stripe key belong in the corresponding mobile build environment, not only in Vercel.

Do not attach real workers to the older synthetic Neon branch. Its provider references belong to process-local mocks. Keep schema-owner migration credentials out of hosted runtime.

## Offline configuration preflight

```sh
pnpm staging:preflight /path/to/ignored-staging.env
```

This reads that explicit file through runtime validators, requires staging mode and rejects live payments. It reports field names only and performs no provider calls, migrations or deployment. Passing validates configuration shape, not credential permissions, data isolation or provider behavior. Re-run after environment changes.

## Deployment verification and remaining release checks

Verify HTTPS health, exact source SHA, authenticated and unauthorized requests, schema compatibility, queue/recovery behavior, Stripe sandbox processing and the relevant end-to-end journey after changes. `/health/live` is process liveness, not comprehensive readiness. Migrations run explicitly before compatible deployment, never during build/startup.

The committed recovery cron runs once per minute; the hosting plan must support that frequency. Do not weaken recovery to accommodate an unsuitable plan. Current deployment readiness does not prove latency/load, dead-letter recovery, physical-device behavior or real production readiness. See [worker hosting](36-worker-hosting.md) and [production setup](production-setup.md).

## Running native apps against staging

From the repository root, run `pnpm dev:staging:rider` or
`pnpm dev:staging:driver`. These launch Metro on ports 8087 and 8088 respectively,
using the staging API, the corresponding Auth0 native client, and synthetic mode
explicitly disabled. The API audience is an Auth0 identifier, not a second backend.

The installed development build must use the matching Metro port. When rebuilding,
use `pnpm --filter @rove/rider exec expo run:ios --port 8087` or
`pnpm --filter @rove/driver exec expo run:ios --port 8088`; use `run:android` for
Android. Launching Metro does not build or install native code.

Provide a sandbox `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` to test rider PaymentSheet.
The launcher rejects live and secret Stripe keys. Configure platform-restricted
Google Maps SDK keys before rebuilding native maps. These public mobile keys are
separate from the API's server credentials. Without them, sign-in can be tested,
but native payment/map verification is incomplete. Never copy the backend `.env`
into either mobile app. Use synthetic accounts and destinations in staging.
