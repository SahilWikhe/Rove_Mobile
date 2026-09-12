# Production setup and release prerequisites

This is the setup sequence for the existing Rove code. It does not provision resources or authorize a production launch. Keep staging operational throughout setup. Use the same reviewed source commit with separate environment configuration; do not copy staging accounts, rides, messages, payment references or uploaded documents into production.

## 1. Establish isolated resources

| Service | Production setup | Existing implementation |
| --- | --- | --- |
| Neon Postgres | Separate production project, empty application database, dedicated runtime and migration roles, verified backups and restore procedure | Versioned SQL in `packages/database/migrations`; runtime requires `sslmode=verify-full` |
| Vercel | Separate API project rooted at `apps/api`, production domain and environment-scoped secrets | `apps/api/vercel.json` defines API rewrites, queue consumer and minute recovery cron |
| Auth0 | Production tenant/API and separate native clients for rider and driver; configure native callbacks/logout, email delivery and verification | OIDC validation and mobile callback/session recovery |
| Stripe | Approved live platform account, payment-method configuration, separate payment and Connect webhook secrets | Payment authorization/capture, payment records, Connect onboarding and capability reconciliation |
| Google Maps | Production project/quotas and separate server, iOS and Android keys with appropriate restrictions | Server Places/Routes integration, native maps and in-app navigation |
| AWS documents | Production stack with private storage, malware scanning and scoped application role | `infra/aws/driver-documents.template.json`; [document storage setup](62-provider-setup-handoff.md) |
| Expo and stores | Rider and driver Expo project IDs, production build environments, signing and APNs/FCM credentials | App-specific EAS profiles and [native build setup](mobile-staging-builds.md) |

Confirm provider plans, quotas and budgets before activation. Staging is an environment name, not a guarantee that provider usage is free. No prices or paid resources are approved by this document.

## 2. Configure the backend

Enter secret values in the production project's secret configuration, never in Git or `EXPO_PUBLIC_*` variables. Use `apps/api/src/config.ts`, `runtime-config.ts` and `hosting-config.ts` as the authoritative field definitions.

Required core settings:

- `ROVE_ENVIRONMENT=production` and production `DATABASE_URL` using the runtime role.
- `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`; production requires verified email. Validate signup, delivery, verification, refresh and logout with the configured native clients.
- Server-only `GOOGLE_MAPS_API_KEY`, with the APIs used by the server enabled and allowed for this key.
- `RATE_POLICY_JSON`, `RATE_POLICY_APPROVED_VERSION` and `SERVICE_AREA_JSON` with approved operating geography and prices. The approved version must match the rate policy. Synthetic/test rate versions are rejected.
- `ALLOWED_ORIGINS_JSON` containing only intended web origins, and a fresh `CRON_SECRET` matching the configured recovery-secret rules.
- `STRIPE_MODE=live`, `STRIPE_ACCOUNT_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PAYMENT_METHOD_CONFIGURATION`. Register the payment endpoint at `/webhooks/stripe`; verify account, mode, signing and durable processing.

Driver payout onboarding additionally uses `STRIPE_CONNECT_ONBOARDING_ENABLED`, `STRIPE_CONNECT_RETURN_ORIGIN`, and a distinct `STRIPE_CONNECT_WEBHOOK_SECRET` for `/webhooks/stripe-connect`. Live activation requires a reviewed Connect model and the exact acknowledgement specified in [payout onboarding](56-driver-payout-onboarding.md). Onboarding readiness is not proof of completed transfers or driver payouts.

For notifications, set distinct `EXPO_RIDER_PROJECT_ID` and `EXPO_DRIVER_PROJECT_ID` matching the apps. Configure `EXPO_PUSH_ACCESS_TOKEN` and `EXPO_PUSH_DELIVERY_ENABLED=true` only after credentials and device registration are ready. Verify delivery and opening on physical devices.

For document intake/scanning, configure `DOCUMENT_S3_BUCKET`, `DOCUMENT_S3_REGION`, `DOCUMENT_S3_OWNER_ACCOUNT_ID`, `DOCUMENT_AWS_ROLE_ARN` and `DOCUMENT_GUARDDUTY_ROLE_ARN` from the production stack. Enable upload/scanning only after role trust, private access and clean/infected sample processing are verified. See `readDocumentStorage`, `readDocumentScanning` and `readDocumentRole` in the runtime configuration.

Run the offline configuration check against one ignored environment file:

```sh
pnpm production:preflight /path/to/ignored-production.env
```

It reads only that file, validates the same runtime configuration as the API, and reports field names without secret values. It rejects nonproduction mode, test payments, synthetic flags, disabled email verification and unapproved rates. It makes no network requests and does not validate that credentials work or prove database isolation. Optional integrations may remain disabled, so a passing result is not launch approval.

## 3. Prepare the database and release controls

The current `db:staging:*` scripts are intentionally staging-specific. Do not point them at production or weaken their environment checks. A production migration runner and controlled release workflow still need implementation and validation against an isolated rehearsal database.

Before production migration, verify the destination project/endpoint, migration-role permissions, backup/restore evidence and existing migration journal. Serialize migrations on a direct database session. Review compatible expansion changes before deploying code; never migrate during application startup or a Vercel build. Do not use a runtime role with schema-owner privileges.

A push to main can deploy staging through its current Git integration. Production must select a specific commit whose CI and staging acceptance passed. Configure production Git behavior so a normal main push cannot bypass the release decision; GitHub CI success alone does not enforce Vercel deployment ordering. The proposed release sequence is in [environment and release controls](08-cicd-and-environments.md).

After deployment, verify authenticated API behavior, webhook processing, delayed queue delivery and recovery cron against the intended database. Rollback must preserve schema compatibility and must not attempt to undo already captured payments. Mobile store releases are separate from API deployment.

## 4. Configure mobile production builds

Populate each role in `config/mobile-production.json` with the reviewed production API URL, Auth0 issuer/audience/client ID and Expo project UUID. These are public identifiers. Put matching values into that app's EAS production environment.

Also configure each platform's `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY` or `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`. Restrict iOS keys to the installed bundle IDs and Android keys to the installed package and actual signing-certificate SHA-1. Enable Navigation SDK access for driver navigation. The rider needs the matching `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` beginning with `pk_live_`. No server secret belongs in a mobile build.

The production profiles set `EXPO_PUBLIC_SYNTHETIC=false`. Their pre-install guard rejects unpopulated release configuration, mismatched endpoints/identity, missing platform keys and test Stripe keys. It checks configuration, not provider authorization or operational readiness.

Once the release gate is satisfied, run from each app directory:

```sh
eas build --platform ios --profile production
eas build --platform android --profile production
```

Builds are not automatically submitted to stores. Complete signing, store metadata, privacy disclosures, review credentials and the required device acceptance before submission. Current staging and production profiles share application identifiers; installing one replaces the other on the same device.

Optional navigation styling uses published Google Cloud styles and the two `EXPO_PUBLIC_GOOGLE_NAVIGATION_*_MAP_ID` settings documented in [driver navigation](58-driver-navigation.md). It is not required to finish core navigation and has separate billing implications.

## 5. Work that setup alone will not finish

Do not enable public rides just because the services are configured. Outstanding release work includes:

- Complete refund/dispute operations and accounting, actual driver money movement, and operational reconciliation; the local synthetic refund adapter and Connect onboarding are not those workflows.
- Fulfill account deletion requests with the approved retention policy and identity/storage handling; the app currently submits requests to support.
- Complete hosted messaging activation and authenticated verification using [the realtime setup](realtime-messaging.md); settle permanent message deletion policy separately from visibility expiry.
- Verify physical-device background location, notifications, native authentication and complete rider/driver trip/payment recovery on both platforms.
- Complete the remaining Figma/UI acceptance and store-release review.
- Implement and rehearse controlled production migrations/releases, monitoring, support ownership and incident recovery.

Final business decisions include launch geography, rider prices/driver compensation, Connect responsibility and payout policy, refunds/cancellation handling, retention/deletion rules, support ownership, and activation budgets. Record these before changing their corresponding production settings.
