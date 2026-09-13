# Neon staging setup

Updated: September 13, 2026.

## Latest RLS verification

The isolated synthetic rehearsal branch has all 72 migrations through 0071. Live catalog inspection confirms thirty-two of 47 tables have RLS enabled and forced. Hosted checks through pooled rove_staging_app (NOSUPERUSER/NOBYPASSRLS) passed for customer provisioning retries, payment reconciliation and capture accounting retries, readiness mutation denial, worker customer isolation and staff permissions. Expanded refund/dispute checks passed for reconciliation retries, read locks with mutation denial, append-only histories, active-dispute payment holds and resolution, and staff queue MFA/permission checks. The existing request limits, installation transfer, push send/receipt retries, messaging, vehicle review, retention, closure and document upload/scan/review/approved cleanup workflows passed again. All external adapters were synthetic; no real provider operation occurred. The temporary branch expires September 14.

The first expanded rehearsal correctly hit ACCOUNT_CLOSURE_HOLD because a payment fixture left driver earnings payable on the document-cleanup driver. The final passing run used a separate synthetic payment driver, preserving the closure safeguard. Provider staging was separately inspected read-only and remains at 31 migrations, 32 tables and zero RLS-enabled/forced tables. Production was not changed. Migrations 0069–0071 are included in the passing hosted rehearsal: authorized refund retry, reviewed loss allocation, driver transfer retry/reversal and immutable transfer receipts passed. The initial run exposed duplicate refund observations caused by property-order-sensitive comparison; structural comparison fixed it, and the entire hosted workflow passed again. Source migration 0072 additionally protects payout-account bindings with restricted-role local verification; its hosted verification is pending. Fourteen current-schema tables still need policies, and compatible API/worker deployment must precede the reviewed provider-staging migration delta. Earlier isolated-rehearsal coverage and pending-verification notes below are historical.

## Current environment selection

Hosted provider staging uses `rove-provider-staging`, endpoint `ep-lucky-bar-ax4k1m1t.c-4.us-east-2.aws.neon.tech`, and ignored `.staging-provider/.env.neon.staging`. It has 31 migration entries through `0030_driver_location_notifications`; the realtime location trigger was verified after migration. It now contains dedicated staging integration records, so the original empty-table observation is historical. Normal API queries use the pooled restricted `rove_staging_app` role; realtime uses a direct connection with that same role/database.

The root `.env.neon.staging` and `pnpm db:staging:migrate`, `db:staging:role`, `db:staging:smoke` commands target the **older synthetic branch below**, not provider staging. Use the explicit provider command under [clean provider-integration branch](#clean-provider-integration-branch). No production schema migration is recorded.

## Original synthetic environment

Created and verified on September 8, 2026:

- Project: `square-frost-35273983` (Rove), AWS US East 2.
- Branch: `rove-staging`, ID `br-falling-mouse-ax3gc8og`.
- Endpoint: `ep-shiny-grass-axcn6ayp.c-4.us-east-2.aws.neon.tech`.
- Database: `neondb`.
- Schema-only branch: production rows were not copied. The production branch was not migrated.
- Fixed 0.25 CU compute with the account's default idle suspension policy.
- All 24 versioned migrations, through `0023_push_deliveries`, applied using Drizzle's migration journal.

This branch is for synthetic integration testing. Both mobile apps share the same backend/database; no second driver database is needed. The normal `pnpm dev:api` and phone previews still use disposable local PostgreSQL. Nothing in this setup deploys an API or changes mobile endpoint configuration.

## Credentials and separation

The ignored, permission-600 `.env.neon.staging` file contains:

```dotenv
ROVE_ENVIRONMENT=staging
NEON_STAGING_HOST=ep-shiny-grass-axcn6ayp.c-4.us-east-2.aws.neon.tech
DATABASE_URL_UNPOOLED=postgresql://OWNER:PASSWORD@DIRECT_HOST/neondb?sslmode=verify-full
DATABASE_URL=postgresql://rove_staging_app:PASSWORD@POOLED_HOST/neondb?sslmode=verify-full
```

Replace the placeholders locally. Never commit credentials or put them in `EXPO_PUBLIC_*` variables. The hostname above is not a secret. The runtime hostname adds `-pooler` before the first dot. URLs require `sslmode=verify-full`, without weaker SSL modes or extra connection parameters.

The schema owner is used only for migrations and role grants. `rove_staging_app` has public-schema table SELECT/INSERT/UPDATE/DELETE and sequence USAGE/SELECT. It has no schema CREATE, table TRUNCATE, superuser, database-creation, role-creation or bypass-RLS privileges. It is not a member of `neon_superuser`. API ownership checks remain essential: this shared backend role can access application rows; it is never issued to clients or dashboard frontends.

Migration defaults grant privileges on future public-schema tables created by the same migration owner. Use that same owner for later migrations, or deliberately configure equivalent default privileges for a different owner. After migrations, `db:staging:role` refreshes existing-table grants without resetting the runtime password.

The ignored `.neon` CLI context points to staging. Do not run a general environment pull over the runtime credentials: it can replace the restricted role URL with the database owner's URL.

## Repeatable commands

From the repository root with the documented Node/pnpm versions:

```sh
pnpm db:staging:migrate
pnpm db:staging:role
pnpm db:staging:smoke
```

These are explicit operations, never startup/build steps. The migration runner takes a session advisory lock over a direct connection, then invokes the existing Drizzle migrations. Re-running skips already-recorded migrations. The runtime smoke uses the pooled application role.

The commands require staging mode, reject Vercel/production execution, and require URLs to match `NEON_STAGING_HOST`. This is an accidental-target guard, not a server-side proof of branch identity: confirm the endpoint belongs to a nonproduction branch in Neon before editing the file. These scripts are intentionally limited to `neondb`.

For another developer, keep normal local development as documented in [local development](19-local-development.md). For hosted testing, give them access to an isolated synthetic Neon branch, confirm its endpoint, and populate their own ignored environment file. On a new branch, initially use its owner's pooled URL for `DATABASE_URL`; run migrations and then `db:staging:role`, which generates and saves a separate runtime-role password. On this existing branch, use the already-provisioned runtime credential through an approved secret-sharing channel; the setup refuses to automatically reset an existing role if those credentials are missing.

Do not share schema-owner credentials as application credentials or copy production data into developer branches. Ordinary CI remains entirely local and does not require Neon credentials.

## What the smoke verifies

The runner calls the actual Hono request handlers and domain services in-process, with database traffic crossing a certificate-verified TLS connection to Neon. It does not start a public server or load the mobile UI.

It verifies:

- Restricted pooled role and the application's actual TLS socket, not the pooler's internal database connection.
- Synthetic rider/driver identities, a quote and idempotent booking.
- Funding reconciliation, automatic matching, driver acceptance and all normal trip transitions.
- Synthetic payment capture retry produces one capture journal and a readable receipt.
- Cross-account trip/receipt requests and invalid authentication are rejected.
- Cancellation releases the synthetic payment hold.
- A fresh database connection sees the completed trip.

Each run uses new synthetic user identifiers and retains records for inspection. Its driver is taken offline at the end. No tables are truncated and no other users' records are removed. Payment and matching services are invoked explicitly for this run; this is not verification of a deployed queue worker, scheduler, webhook or HTTP ingress.

Synthetic provider state exists only during the smoke process. Its persisted outbox records are test artifacts; do not attach real payment workers to this synthetic branch or expect to resume old synthetic payment attempts after a process restart. Use a separate clean staging branch for real Stripe sandbox/provider integration. Inspect failed-run records before any scoped cleanup; never reset this branch without checking for other developers' work.

## Remaining deployment work

Vercel, Auth0, Maps and Stripe sandbox are configured for the separate provider branch. Push delivery and full device/provider acceptance remain open. Normal runtime queries receive the pooled restricted URL; realtime receives a direct restricted URL. Migration credentials belong in a separately controlled operation. Real production setup, backups/recovery rehearsal, load/cold-start behavior and physical-device journeys are still unverified.

## Clean provider-integration branch

On September 8, 2026, created a second schema-only staging branch for real sandbox integrations:

- Name: `rove-provider-staging`; branch ID: `br-super-leaf-axpo6edu`.
- Same project: `square-frost-35273983`.
- Direct endpoint: `ep-lucky-bar-ax4k1m1t.c-4.us-east-2.aws.neon.tech`.
- Fixed 0.25 CU, default idle suspension; no plan upgrade.
- At creation, 24 migrations and 26 empty public tables were verified. Current provider staging has 31 migration entries through 0030 and is no longer empty.
- Separate `rove_staging_app` password and verified pooled TLS. Role has no superuser, role/database creation, bypass-RLS, schema CREATE or table TRUNCATE permission.

Credentials are in `.staging-provider/.env.neon.staging` (ignored, mode 600) with the same four keys described above. This separate working directory allows the existing role-provisioning script to operate without replacing the original synthetic environment. Existing `.neon` context, local phone backend and root `.env.neon.staging` remain unchanged.

From repository root, migrate this branch explicitly:

```sh
node --env-file=.staging-provider/.env.neon.staging --import tsx packages/database/src/staging-migrate.ts
```

To refresh role grants after migrations, load this file and run the existing role script with `.staging-provider` as its working directory:

```sh
node --env-file=.staging-provider/.env.neon.staging --import tsx --input-type=module -e 'const moduleUrl = new URL("./packages/database/src/staging-role.ts", "file://" + process.cwd() + "/"); process.chdir(".staging-provider"); await import(moduleUrl.href);'
```

Do not run the synthetic ride smoke against this branch. It is reserved for managed-auth staging accounts and actual sandbox-provider IDs. No payment/provider calls, application rows or Vercel environment upload were made during the original September 8 provisioning; subsequent provider integration and deployment supersede that initial state. The empty-table check is a provisioning observation, not a permanent invariant after provider testing begins.

## Repeatable read-only readiness check

Run from the repository root:

```sh
pnpm db:staging:check .staging-provider/.env.neon.staging
```

Use an explicit ignored environment file whose endpoint has already been confirmed as a staging branch in Neon. The checker cannot identify a production branch from its hostname alone. It uses only the pooled runtime credentials from that file; owner credentials and ambient database variables are not used. No migrations, grants, fixture inserts or application workers run.

The check validates certificate-authorized TLS on the actual client socket, starts a read-only transaction with a statement timeout, and requires the restricted role, no other role memberships, no dangerous role flags or public-schema creation, individual SELECT/INSERT/UPDATE/DELETE grants on each public application table, no TRUNCATE, and USAGE/SELECT on sequences. A pooler's internal PostgreSQL hop may not use TLS, so `pg_stat_ssl` is not used as evidence for the client connection. Connections are destroyed even on failure. Fixed diagnostic stages help locate failures without printing provider errors or secrets.

On September 9 this passed against clean provider staging with 26 tables. Permission failure cases are tested against disposable local PostgreSQL. The command does not verify migration journal completeness, data cleanliness, per-user application authorization, default grants for future migrations or any external provider. Re-run it after migrations or credential/grant changes; retain the separate migration and API behavior checks.

## Row-level security evidence

Migration 0048 now enables and forces PostgreSQL RLS on saved_places with owner and permission-scoped staff policies. Migration 0049 extends enabled/forced RLS to trip_messages, trip_message_reads and trip_message_reports. Other application tables remain uncovered. These migrations were verified on an isolated synthetic Neon rehearsal branch; provider staging still has no enabled RLS tables. Consumer data access currently depends on authenticated backend resource authorization; mobile clients do not connect directly to PostgreSQL. `NOBYPASSRLS` on the application role does not enable RLS.

`pnpm db:staging:check /path/to/ignored-staging.env` now reads the PostgreSQL catalog in its existing read-only transaction and reports enabled/forced table counts plus RLS-disabled table names. It reads no application row content. Passing its role/grant checks does not mean RLS or cross-account row isolation is verified. A policy can exist while RLS is disabled; even enabled policies require behavior tests using the actual runtime role.

Local PostgreSQL tests cover disabled RLS despite NOBYPASSRLS, enabled tables without policies, forced RLS with a policy, and disabling RLS while retaining policy metadata. The new report has not yet been run against hosted Neon. Extending RLS requires transaction-scoped identity and worker/staff access coverage; the catalog report itself does not change authorization or enable policies.

## RLS implementation in progress

The backend now has an explicit `actorTransaction` helper: validate the backend-supplied actor, begin a transaction, clear each RLS identity setting locally, confirm and lock the active database-owned account/role, set `rove.actor_id`, `rove.actor_role` and `rove.actor_mfa` transaction-locally, then execute the scoped work. Write operations request an exclusive owner lock initially to avoid concurrent lock-upgrade deadlocks. Saved-place reads, resolution, updates and removal now use this helper.

The actor must originate from verified backend authentication; these settings are not an independent authentication mechanism and must never be filled from arbitrary request headers or body fields. A compromised database credential capable of issuing arbitrary SQL is outside this identity-setting boundary. No implicit worker or staff bypass is provided. Existing backend resource authorization remains required.

Local tests apply the versioned migrations to a disposable PostgreSQL database, assert saved_places has enabled/forced RLS, and connect with a separate non-owner, NOSUPERUSER/NOBYPASSRLS login. They exercise cross-account read/update/delete denial, foreign inserts, legitimate saved-place service behavior, concurrent first writes, pooled identity isolation after commit/rollback/interleaving, and forged/disabled/missing actors. The tests now exercise the actual generated migration policies, including staff inventory and account closure; they are not hosted evidence.

Remaining before staging enablement: versioned production policies, authentication lookup/bootstrap policy, all direct pool reads and domain transaction coverage, explicit staff/worker privileges, cleanup and financial workflow compatibility, isolated Neon branch verification and rollout against the confirmed staging branch. Saved places and the three trip-messaging tables now have versioned policies; complete application-table coverage remains unfinished.

PostgreSQL documents [row security policy behavior](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), including default denial and owner/superuser bypass, and [transaction-local configuration](https://www.postgresql.org/docs/current/functions-admin.html).

### Saved-place RLS migration and deployment ordering

Migration `0048_saved_places_rls` is generated from Drizzle pgPolicy declarations; a reviewed SQL statement additionally forces RLS because the schema snapshot represents enablement/policies but not FORCE. Owners can access their own saved places only while their database account is active and its role is rider. Staff privacy reads require MFA and current `privacy.read`. Staff closure SELECT/DELETE requires MFA, current `privacy.close` and a disabled target account. Staff read permission alone cannot delete, and closure permission cannot delete an active account's saved places. The API inventory transaction and closure command now install verified staff identity before touching saved_places.

Deploy the compatible API code before applying this migration to staging. Old binaries use unscoped queries and would lose saved-place access under RLS. Do not apply it blindly to a target running older code. The current migration does not affect other tables or authorize anonymous/default workers to read saved places. Do not grant runtime roles ownership, superuser or BYPASSRLS to make failing flows pass.

Local verification passed 33 related domain tests (including six restricted-role identity/policy tests), 13 database tests and 64 API/runtime tests. Hosted branch rehearsal, deployment ordering and catalog/behavior evidence remain pending.

### Messaging RLS migration

Migration 0049 enables and forces RLS on trip_messages, trip_message_reads and trip_message_reports. Participant policies require an accepted current assignment, active participant accounts and the existing active-trip/recent-trip history boundary. Inserts bind the sender/reporter to the actor; message inserts additionally require an active trip and no report. Read markers are owner-scoped. Participants cannot update/delete message bodies or remove reports. Individual message-text expiry, pagination, rate limits and complete send/retry rules remain enforced by the messaging domain; RLS does not replace those checks.

All MessagingService transactions now bind the authenticated actor. Privacy inventory requires privacy.read; cleanup binds staff MFA and privacy.cleanup before reading/deleting closed-account messages. The cleanup engine still applies exact reviewed IDs, cutoff, closure, terminal state, participant holds and report guards; its RLS permission is not standalone approval of erasure. Cleanup eligibility uses participant/ride locks rather than SELECT FOR UPDATE on messages, which would require an unnecessary message UPDATE policy.

Message-notification delivery uses transaction-local notification message/offer identifiers derived from a current outbox event. These permit only the event's message and its conversation's read/report metadata; no global worker bypass is granted. The audience resolver still rechecks current assignment, account status, reports and read position before producing a body-free notification. Actor binding clears notification scope as well as resetting identity fields. These are backend-controlled settings, never mobile request inputs.

Messaging and cleanup tests now run their services with separate NOSUPERUSER/NOBYPASSRLS non-owner logins under the actual migrations. Coverage includes realtime notification eligibility/read suppression, retries, reports, replacements, concurrency, privacy cleanup, and direct foreign SQL read/write attempts. The related domain set passed 33 tests, database set 13 and API/runtime set 64. This remains local evidence. Deploy compatible API and worker code before applying 0049; isolated Neon rehearsal and verified staging enablement are pending.

## Hosted RLS rehearsal — September 13

An isolated branch cloned from the older synthetic staging branch successfully applied all 50 migrations through 0049. Before cloning, a read-only query confirmed nine users and zero subjects outside the synthetic fixture namespace. The rehearsal branch is set to expire September 14. Catalog inspection after migration returned 47 application tables, four with both RLS enabled and forced.

The pooled restricted application login passed synthetic ownership, foreign-insert rejection, messaging assignment/retry, notification read suppression, pooled identity reset, permission-scoped inventory, account closure and reviewed message cleanup/replay checks. Notification checks resolved audiences only; no push delivery, external identity erasure or payment was performed. This verifies the four current policy tables on Neon, not remaining-table protection or physical/mobile production acceptance.

A separate read-only inspection of provider staging returned 31 migrations, 32 tables and zero RLS-enabled/forced tables. Do not apply only the two RLS migrations out of sequence: the hosted environment has an earlier schema and needs a reviewed migration delta plus compatible API/worker deployment. Provider staging and production were not altered by the rehearsal.

## Vehicle policy extension in source

Migration 0050 adds enabled/forced policies for driver_vehicle_submissions, driver_vehicle_history and vehicle_review_decisions, bringing source coverage to seven tables. Current submission owners may read, insert pending submissions and replace them with pending revisions; they cannot approve themselves. Historical facts and decisions have no runtime UPDATE/DELETE policies. Current MFA vehicle reviewers can inspect and decide; eligibility reviewers can read current submissions but cannot edit them. Driver-facing response projections continue to hide internal review notes and reviewer identity: row policies do not provide column-level redaction.

Driver submission, vehicle review and eligibility services install transaction-local actor identity. Deploy compatible service code before applying the migration. The restricted-role local suites passed alongside the API and database tests; this extension has not been applied to hosted Neon. The earlier hosted four-table rehearsal remains the extent of hosted RLS evidence.

## Support policy extension in source

Migration 0051 extends enabled/forced RLS to support_requests, bringing source coverage to eight of 47 tables. Consumer owners can read and insert open tickets; only current MFA staff with both support.read and support.resolve can resolve them. Privacy inventory retains permission-scoped read access. Support services install transaction-local identity, and messaging report creation continues through its existing actor transaction. Restricted-role domain checks and API/database regression suites passed. This migration has not been applied to hosted Neon; deploy compatible backend code before staging migration.

## Deletion-consent policy extension in source

Migration 0052 adds enabled/forced RLS to account_deletion_requests, bringing source coverage to nine of 47 tables. Consumer ownership controls consent and withdrawal; current MFA privacy staff have read access. Identity removal uses exact request scope restricted to an existing closure and disabled owner. Compatible actor/worker transactions must be deployed before migration. Local restricted-role and API/database checks passed, but this migration has not been applied to hosted Neon. Account closures and remaining tables still need coverage.

## Closure policy extension in source

Migration 0053 adds enabled/forced RLS to account_closures, bringing source coverage to ten of 47 tables. Staff reads/inserts and identity/document workers use distinct scoped policies. The closed-account trigger retains owner-specific visibility so hidden rows cannot permit reactivation. Compatible actor/worker code must precede migration. Local domain/API/database checks passed; hosted verification remains the earlier four-table rehearsal and provider staging is unchanged.

## Retention policy extension in source

Migration 0054 adds enabled/forced RLS to retention_holds, bringing source coverage to eleven of 47 tables. Distinct current MFA staff permissions govern placement, reads and release. A scoped boolean database helper preserves hold visibility for closure/document deletion guards without exposing hold records to ordinary consumers. Local restricted-role and API/database suites passed; hosted verification remains the earlier four-table rehearsal. Deploy compatible backend code before the migration delta.

## Cleanup plan policy extension in source

Migration 0055 adds enabled/forced RLS to document_cleanup_plans and document_cleanup_items, bringing source coverage to thirteen of 47 tables. Staff approval and exact-item worker execution have separate policies, and both dispatch/receipt transactions bind worker scope. Local restricted-role/API/database verification passed. Hosted evidence remains the preceding eleven-table rehearsal; this migration has not been applied to Neon. Deploy compatible backend code before staging migration.

## Document-review policy extension in source

Migration 0056 adds enabled/forced RLS to driver_document_reviews, bringing source coverage to fourteen of 47 tables. Driver ownership and current MFA review/eligibility permissions govern reads; document-review permission governs inserts. Document services now prepare verified actor context for the remaining lifecycle policies. The full server suite passed 684 tests alongside API/database checks. Hosted verification remains the earlier eleven-table rehearsal, and provider staging is unchanged.
