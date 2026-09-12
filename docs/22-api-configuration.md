# API deployment configuration

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

`apps/api/src/config.ts` validates explicit environment input without reading ambient credentials. `apps/api/.env.example` lists required keys without secrets or approved business values. This module is implemented and tested; the real-adapter HTTP/worker/realtime composition is implemented and staging is deployed; production environment setup remains unfinished. It does not deploy an API, connect to Neon or enable real bookings by itself.

## Required settings

| Key | Meaning |
| --- | --- |
| `ROVE_ENVIRONMENT` | `preview`, `staging` or `production`; explicit even when Node uses production optimization |
| `DATABASE_URL` | Dedicated runtime Postgres credentials; `postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=verify-full` |
| `OIDC_ISSUER` | Exact HTTPS issuer expected in access tokens |
| `OIDC_AUDIENCE` | API audience, not implicitly the mobile client identifier |
| `OIDC_JWKS_URL` | Trusted HTTPS signing-key endpoint from the identity provider |
| `GOOGLE_MAPS_API_KEY` | Server-only Places/Routes credential with provider restrictions and quotas |
| `RATE_POLICY_JSON` | Complete explicit fare and driver-earnings policy described below |
| `SERVICE_AREA_JSON` | Numeric `south`, `north`, `west`, `east`; ordered bounds within valid latitude/longitude ranges |
| `RATE_POLICY_APPROVED_VERSION` | In production, must exactly match the reviewed rate version; a matching value records operator intent, not proof of commercial/legal approval |
| `ALLOWED_ORIGINS_JSON` | Optional array of exact HTTPS browser origins; defaults to empty. No wildcards, credentials, paths or fragments |

Rate policy fields are `version`, `baseCents`, `centsPerKilometer`, `centsPerMinute`, `minimumCents`, `driverBaseCents`, `driverCentsPerKilometer`, `driverCentsPerMinute`, and `driverMinimumCents`. Every amount is an integer between zero and one million. Unknown fields are rejected so typos cannot silently change pricing. Production rejects synthetic/fixture/test version names. Business approval, taxes, cancellation rules and provider costs still need the final handoff decisions.

Database URLs require a database, username/password and an explicit `sslmode=verify-full`. Ambiguous repeated modes and additional URL options are rejected. Percent-encode credential characters when assembling a URL. Do not disable certificate verification to address connection errors. Migrations will use a separate credential and release step; this configuration is for runtime access only.

Identity URLs cannot include credentials or fragments. Browser CORS origins do not authorize users: signed tokens and database-owned permissions remain mandatory. Mobile clients never receive the database or server maps keys.

## Isolation and error handling

A Vercel preview cannot select production configuration. A Vercel production deployment may host an intentionally separate staging project, but cannot select preview configuration. Environment labels cannot prove database isolation: provision separate production/nonproduction resources and verify their project links before setting credentials.

Synthetic-mode flags are rejected by deployment configuration. The existing local synthetic server remains a separate entrypoint with disposable PostgreSQL and fixture providers.

Validation errors include only field names. Do not log parsed configuration, original environment values or raw schema errors. Six regression tests cover missing settings, malformed JSON, secret redaction, TLS downgrade/ambiguity, HTTPS/CORS constraints, pricing/area validation and production-preview mistakes.

## Optional Auth0 verification resend

`AUTH0_VERIFICATION_CLIENT_ID` and `AUTH0_VERIFICATION_CLIENT_SECRET` enable server-only verification-email jobs. Both must be present together; omitting both leaves resend unavailable without weakening the email gate. The client must belong to the standard Auth0 tenant identified by `OIDC_ISSUER` and have the Management API `update:users` grant. Do not expose these through `EXPO_PUBLIC_*`. Configuration, domain limitations and the required hosted acceptance steps are in [authentication recovery](46-auth-refresh-recovery.md#deferred-server-setup).

## Refund tracking flag

`PAYMENT_REFUNDS_ENABLED` accepts only `true` or `false` and defaults off. Enable only after migration 0031 and compatible rider rollout. API and worker must share the setting; see [refund tracking rollout](66-refund-tracking.md).

## Refund mutation flag

`PAYMENT_REFUND_OPERATIONS_ENABLED=true` requires `PAYMENT_REFUNDS_ENABLED=true`. It enables staff-authorized provider mutations and requires migration 0032. It defaults off independently of read-only refund tracking. See [setup and remaining acceptance](67-refund-operations.md).

## Refund balance accounting

`PAYMENT_REFUND_ACCOUNTING_ENABLED=true` requires refund tracking and migration 0033. It records verified processor refund/failure movements with fee and suspense entries and defaults off. See [refund balance accounting](68-refund-accounting.md).
