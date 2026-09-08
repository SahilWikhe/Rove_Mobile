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

No environment variables have been uploaded to Vercel yet.

The ignored, permission-600 `.env.vercel.staging.partial` holds only a partial local configuration: staging mode, empty browser origins, synthetic rate/service-area fixtures, disabled Connect/push, Stripe test mode/account identifier and a generated recovery secret. It is not an import-ready complete runtime environment. Never commit or print its values.

Still needed: a clean provider-testing database branch and pooled restricted-role URL; OIDC issuer/audience/JWKS from the chosen provider; Google Maps credentials; Stripe sandbox API credentials, an appropriate payment-method configuration and webhook signing secret. Provider connections in the assistant do not supply runtime credentials to the backend automatically.

Do not attach real payment workers to the existing synthetic Neon branch. Its outbox/payment records belong to process-local mock providers; see [Neon staging](60-neon-staging.md).

## Deployment gate and verification

The current recovery cron runs once per minute. Keep that recovery design intact; the current Hobby plan cannot run that schedule. The user will handle the upgrade later.

After configuration and deployment authorization: verify build output, HTTPS health, authenticated and unauthorized requests, restricted database access, queue delivery/retries, recovery cron authentication, Stripe sandbox webhook reconciliation and a complete test ride. Migrations run explicitly against the intended branch, never during API startup/build. Mobile previews remain local until the hosted environment is verified.

## Status maintenance

Every commit/push must include an accurate checkpoint in [implementation status](18-implementation-status.md), with completed work, actual checks, blockers and next steps. Update this runbook when cloud settings or readiness change. Cloud creation and successful local builds do not constitute deployed verification.

## API references

Project creation and verification follow the official [create project](https://vercel.com/docs/rest-api/projects/create-a-new-project) and [project settings](https://vercel.com/docs/rest-api/projects/update-an-existing-project) API documentation. Creating the project does not build or deploy the repository.
