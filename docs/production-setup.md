# Production setup and release prerequisites

This is the setup sequence for the existing Rove code. It does not provision resources or authorize a production launch. Keep staging operational throughout setup. Use the same reviewed source commit with separate environment configuration; do not copy staging accounts, rides, messages, payment references or uploaded documents into production.

## 1. Establish isolated resources

| Service         | Production setup                                                                                                                           | Existing implementation                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Neon Postgres   | Separate production project, empty application database, dedicated runtime and migration roles, verified backups and restore procedure     | Versioned SQL in `packages/database/migrations`; runtime requires `sslmode=verify-full`            |
| Vercel          | Separate API project rooted at `apps/api`, production domain and environment-scoped secrets                                                | `apps/api/vercel.json` defines API rewrites, queue consumer and minute recovery cron               |
| Auth0           | Production tenant/API and separate native clients for rider and driver; configure native callbacks/logout, email delivery and verification | OIDC validation and mobile callback/session recovery                                               |
| Stripe          | Approved live platform account, payment-method configuration, separate payment and Connect webhook secrets                                 | Payment authorization/capture, payment records, Connect onboarding and capability reconciliation   |
| Google Maps     | Production project/quotas and separate server, iOS and Android keys with appropriate restrictions                                          | Server Places/Routes integration, native maps and in-app navigation                                |
| AWS documents   | Production stack with private storage, malware scanning and scoped application role                                                        | `infra/aws/driver-documents.template.json`; [document storage setup](65-driver-documents.md) |
| Expo and stores | Rider and driver Expo project IDs, production build environments, signing and APNs/FCM credentials                                         | App-specific EAS profiles and [native build setup](mobile-staging-builds.md)                       |

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

For realtime messaging and rider location, set `REALTIME_DATABASE_URL` to the direct, non-pooled URL for the same database and restricted runtime role as `DATABASE_URL`, with `sslmode=verify-full`. Apply migrations through 0030 before enabling the endpoint and verify authenticated WSS delivery/reconnect. Without this setting the apps fall back to polling; see [realtime setup](realtime-messaging.md).

Driver payout onboarding additionally uses `STRIPE_CONNECT_ONBOARDING_ENABLED`, `STRIPE_CONNECT_RETURN_ORIGIN`, and a distinct `STRIPE_CONNECT_WEBHOOK_SECRET` for `/webhooks/stripe-connect`. Live activation requires a reviewed Connect model and the exact acknowledgement specified in [payout onboarding](56-driver-payout-onboarding.md). Onboarding readiness is not proof of completed transfers or driver payouts.

Populate each app’s approved `ANDROID_FIREBASE_PROJECT_ID` in `config/mobile-production.json` before a production Android build. The pre-install check rejects an omitted/mismatched Firebase client file or a service-account private key. This project ID is build approval data, not a secret.

For Android notifications, supply each matching Firebase client file through EAS production secret file variable `GOOGLE_SERVICES_JSON`, and configure FCM V1 service-account credentials separately in EAS. Rebuild after configuration; see [push setup](59-push-notifications.md#android-firebase-file-and-channel-setup).

For notifications, set distinct `EXPO_RIDER_PROJECT_ID` and `EXPO_DRIVER_PROJECT_ID` matching the apps. Configure `EXPO_PUSH_ACCESS_TOKEN` and `EXPO_PUSH_DELIVERY_ENABLED=true` only after credentials and device registration are ready. Verify delivery and opening on physical devices.

For document intake/scanning, configure `DOCUMENT_S3_BUCKET`, `DOCUMENT_S3_REGION`, `DOCUMENT_S3_OWNER_ACCOUNT_ID`, `DOCUMENT_AWS_ROLE_ARN` and `DOCUMENT_GUARDDUTY_ROLE_ARN` from the production stack. Enable upload/scanning only after role trust, private access and clean/infected sample processing are verified. See `readDocumentStorage`, `readDocumentScanning` and `readDocumentRole` in the runtime configuration.

Run the offline configuration check against one ignored environment file:

```sh
pnpm production:preflight /path/to/ignored-production.env
```

It reads only that file, validates the same runtime configuration as the API, and reports field names without secret values. It rejects nonproduction mode, test payments, synthetic flags, disabled email verification and unapproved rates. It makes no network requests and does not validate that credentials work or prove database isolation. Optional integrations may remain disabled, so a passing result is not launch approval.

## 3. Prepare the database and release controls

The current `db:staging:*` scripts are intentionally staging-specific. Do not point them at production or weaken their environment checks. Use the [production migration runner](production-migrations.md) for explicit planning and application. It is rehearsed against disposable local databases; the controlled production deployment workflow and provider-specific rehearsal remain outstanding.

Before production migration, verify the destination project/endpoint, migration-role permissions, backup/restore evidence and existing migration journal. Serialize migrations on a direct database session. Review compatible expansion changes before deploying code; never migrate during application startup or a Vercel build. Do not use a runtime role with schema-owner privileges.

A push to main can deploy staging through its current Git integration. Production must select a specific commit whose CI and staging acceptance passed. Configure production Git behavior so a normal main push cannot bypass the release decision; GitHub CI success alone does not enforce Vercel deployment ordering. The proposed release sequence is in [environment and release controls](08-cicd-and-environments.md).

After deployment, verify authenticated API behavior, webhook processing, delayed queue delivery and recovery cron against the intended database. Rollback must preserve schema compatibility and must not attempt to undo already captured payments. Mobile store releases are separate from API deployment.

Check the candidate against GitHub Actions with an authenticated `gh` CLI:

```sh
pnpm release:check SahilWikhe/Rove_Mobile <full-commit-sha> <ci-run-id> <staging-provider-run-id>
```

This read-only command requires successful CI and staging-provider workflows on main for the exact commit, including every required job from the recorded run attempt. Missing, skipped, stale or failed evidence exits nonzero. It does not deploy, grant production approval, or replace hosted mobile acceptance, migration review and backup verification. The command rechecks both workflow attempts after collecting jobs and rejects an intervening rerun or status change. Run it again immediately before a release; its output is a point-in-time check, not an authorization token.

### GitHub code-scanning prerequisite

The private repository currently returns Code scanning is not enabled when CodeQL uploads analysis (run `34706864852`, September 12). Its workflow metadata permission is fixed; feature availability is a separate owner setup step. Enable code scanning for this repository under an eligible GitHub Code Security/Advanced Security entitlement, then rerun CI and confirm both analysis upload and the local findings gate pass. If the current account cannot enable it, resolve the repository/account eligibility before release. No plan purchase or feature activation has been performed. Do not bypass CodeQL or treat query execution alone as a green security job.

### Manual GitHub release-readiness report

In GitHub Actions, choose **Release readiness → Run workflow**, select `main`, and enter the full candidate commit SHA plus its successful CI and staging-provider run IDs. The candidate must belong to the selected main history. This uses GitHub's read-only workflow token; no additional secret or production service setup is needed.

The workflow runs the trusted main-checkout verifier, validates all required jobs and current run attempts for the exact candidate, and retains `evidence.txt` for 30 days. It records both candidate and verifier source commits. Missing, mismatched, pending or failed evidence fails the job and produces no success artifact. Inputs are passed as environment values and validated before invoking Git or GitHub.

This workflow reads existing GitHub evidence only. It does not rerun staging providers, incur Maps requests, deploy Vercel, migrate a database, approve production or submit mobile apps. The report is a point-in-time snapshot: rerun readiness before a release if evidence changes. Device acceptance, approved policies, production isolation, migration/restore rehearsal and actual deployment remain separate requirements. The existing main-to-staging integration is unchanged; the protected production promotion workflow still needs the final production project and release setup.

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

- Complete refund/dispute operations and accounting, actual driver money movement, and operational reconciliation; the refund adapter and Connect onboarding are not those workflows.
- Fulfill account deletion requests with the approved retention policy and identity/storage handling; the app currently submits requests to support.
- Repeat [realtime messaging acceptance](realtime-messaging.md) against the production configuration before launch. Staging authenticated WebSocket delivery, retry, read updates and reconnect recovery passed with dedicated test accounts; permanent message deletion policy remains separate from visibility expiry.
- Verify physical-device background location, notifications, native authentication and complete rider/driver trip/payment recovery on both platforms.
- Complete the remaining Figma/UI acceptance and store-release review.
- Implement and rehearse controlled production migrations/releases, monitoring, support ownership and incident recovery.

Final business decisions include launch geography, rider prices/driver compensation, Connect responsibility and payout policy, refunds/cancellation handling, retention/deletion rules, support ownership, and activation budgets. Record these before changing their corresponding production settings.

## Payment loss allocation checkpoint

The protected, audited allocation API is implemented locally behind a default-off flag. See [payment loss allocation](70-payment-loss-allocation.md) for signed balances, policy requirements, migration 0035 and compatible net driver earnings presentation. No hosted rollout or production settlement acceptance is implied.

## Driver transfers

The protected reservation, transfer worker and reconciliation workflow is implemented behind `PAYMENT_DRIVER_TRANSFERS_ENABLED=false`. Apply migrations 0036–0037 before deployment, including when existing refund operations are enabled. See [driver transfer rollout](72-driver-transfer-workflow.md) for required tracking/accounting flags, Connect setup, the explicit charge-model acknowledgement, staff permissions and provider acceptance. No production flag, transfer or bank payout was activated. Final policy, paid setup and bank-payout presentation/acceptance remain outstanding.
