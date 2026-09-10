# Vercel staging preparation

Updated: September 8, 2026.

## Scope and current state

Prepare a separate `rove-api-staging` project in `team-7536` (`team_lNgElVK3RUXfpIY43YCvpbCS`). The existing `rove` project is the marketing website. Created the backend project and verified its settings with a separate API read on September 8, 2026. Project ID: `prj_rLOcpNrXI7eftPgzzRebQbgfCkMC`. [Open staging project](https://vercel.com/team-7536/rove-api-staging). Confirmed zero deployments, no Git connection and no environment variables. Nothing is deployed. Do not upgrade the plan or start a deployment as part of this preparation.

## Verified project settings

- Root directory: `apps/api`.
- Include source files outside the root directory for shared workspace packages.
- Framework: Other, matching `framework: null` in `apps/api/vercel.json`.
- Node.js: 24.x.
- Install: `pnpm install --frozen-lockfile`.
- Build: `pnpm build`.
- Output directory: `public`.
- Runtime region: `iad1`, defined by the committed Vercel configuration.
- Initially leave Git disconnected to prevent automatic deployment before provider/environment setup is complete.

This project's eventual Vercel Production target is still application **staging**, with `ROVE_ENVIRONMENT=staging`. It must never receive the real production database or live Stripe credentials. Preview environments need deliberate database/provider isolation before enabling branch deployments.

## Environment readiness

See [provider account setup](62-provider-setup-handoff.md) for exact auth, server/mobile maps and Stripe sandbox configuration, source-code mappings and outstanding owner decisions.

No environment variables have been uploaded to Vercel yet.

The ignored, permission-600 `.env.vercel.staging.partial` holds only a partial local configuration: staging mode, empty browser origins, synthetic rate/service-area fixtures, disabled Connect/push, Stripe test mode/account identifier and a generated recovery secret. It is not an import-ready complete runtime environment. Never commit or print its values.

The clean `rove-provider-staging` database branch is now migrated and its restricted runtime URL is saved locally; see [database setup](60-neon-staging.md#clean-provider-integration-branch). It has not been uploaded to Vercel. Still needed: OIDC issuer/audience/JWKS from the chosen provider; Google Maps credentials; Stripe sandbox API credentials, an appropriate payment-method configuration and webhook signing secret. Provider connections in the assistant do not supply runtime credentials to the backend automatically.

Do not attach real payment workers to the existing synthetic Neon branch. Its outbox/payment records belong to process-local mock providers; see [Neon staging](60-neon-staging.md).

## Offline configuration preflight

From the repository root:

```sh
pnpm staging:preflight /path/to/ignored-staging.env
```

The command reads exactly that file, not ambient provider credentials. It uses the same API/payment/optional-integration validation as hosted runtime and the same recovery-secret validation as hosted startup. Missing/invalid configuration exits nonzero with field names only. It requires application staging mode and rejects live payments. It neither connects to providers/database nor deploys, migrates or changes settings.

Validation follows the runtime parser order, so fix reported fields and rerun to reveal later payment/integration errors. A passing result proves configuration shape only: syntactically valid fixtures can pass. It does not prove credentials work, pricing is approved, the database branch is isolated, the role is restricted or the hosting plan supports the configured schedule.

The existing partial file was checked and correctly rejected for missing database, maps and OIDC fields. Its remaining Stripe credentials must still be supplied after those fields are resolved. Do not treat that initial error list as the entire deployment checklist.

## Deployment gate and verification

The current recovery cron runs once per minute. Keep that recovery design intact; the current Hobby plan cannot run that schedule. The user will handle the upgrade later.

After configuration and deployment authorization: verify build output, HTTPS health, authenticated and unauthorized requests, restricted database access, queue delivery/retries, recovery cron authentication, Stripe sandbox webhook reconciliation and a complete test ride. Migrations run explicitly against the intended branch, never during API startup/build. Mobile previews remain local until the hosted environment is verified.

## Status maintenance

Every commit/push must include an accurate checkpoint in [implementation status](18-implementation-status.md), with completed work, actual checks, blockers and next steps. Update this runbook when cloud settings or readiness change. Cloud creation and successful local builds do not constitute deployed verification.

## API references

Project creation and verification follow the official [create project](https://vercel.com/docs/rest-api/projects/create-a-new-project) and [project settings](https://vercel.com/docs/rest-api/projects/update-an-existing-project) API documentation. Creating the project does not build or deploy the repository.
