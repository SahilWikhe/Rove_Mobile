# Neon staging setup

Updated: September 13, 2026.

## Latest RLS verification

The isolated synthetic rehearsal branch has all 79 migrations through 0078. Live catalog inspection confirms forty-one of 47 tables have RLS enabled and forced. Hosted checks through pooled rove_staging_app (NOSUPERUSER/NOBYPASSRLS) passed for customer provisioning retries, payment reconciliation and capture accounting retries, readiness mutation denial, worker customer isolation and staff permissions. Expanded refund/dispute checks passed for reconciliation retries, read locks with mutation denial, append-only histories, active-dispute payment holds and resolution, and staff queue MFA/permission checks. The existing request limits, installation transfer, push send/receipt retries, messaging, vehicle review, retention, closure and document upload/scan/review/approved cleanup workflows passed again. All external adapters were synthetic; no real provider operation occurred. The temporary branch expires September 14.

The first expanded rehearsal correctly hit ACCOUNT_CLOSURE_HOLD because a payment fixture left driver earnings payable on the document-cleanup driver. The final passing run used a separate synthetic payment driver, preserving the closure safeguard. Provider staging was separately inspected read-only and remains at 31 migrations, 32 tables and zero RLS-enabled/forced tables. Production was not changed. Migrations 0069–0071 are included in the passing hosted rehearsal: authorized refund retry, reviewed loss allocation, driver transfer retry/reversal and immutable transfer receipts passed. The initial run exposed duplicate refund observations caused by property-order-sensitive comparison; structural comparison fixed it, and the entire hosted workflow passed again. Migrations 0072–0073 also passed hosted verification: payout onboarding retry, reconciliation, bank history, owner/mutation denial, both webhook inboxes with source/event isolation, replay/conflict detection and immutable receipts. All verifiers and provider adapters were synthetic. Migration 0074 also passed hosted tracking rotation, location upload, read-scope mutation denial, revocation and retained-grant deletion by account closure using synthetic coordinates. Migration 0075 passed hosted command retry, actor/key isolation, immutable result, foreign insertion denial, failed-work rollback, disabled-account replay denial and pool-context reset checks, followed by the complete existing hosted regression workflow. Ten current-schema tables still need policies, and compatible API/worker deployment must precede the reviewed provider-staging migration delta. Earlier isolated-rehearsal coverage and pending-verification notes below are historical.

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

## Audit append policy — migration 0076

Source RLS coverage reaches 38 of 47 tables. Audit inserts require the exact transaction-local record scope populated by appendAudit; runtime SELECT, UPDATE and DELETE are denied. Service methods continue to authorize the underlying actions. The policy does not claim protection against arbitrary SQL execution by a compromised backend credential. Deploy the compatible backend/worker helper before applying this migration.

Local verification passed 729 server, 208 API and 13 database tests, including restricted-role field mismatch, unscoped insertion, history mutation/read denial and rollback tests. Hosted rehearsal remains at migration 0075 (37 tables) until the next explicit rehearsal. Provider staging and production remain unchanged.

Hosted follow-up: migration 0076 was applied only to br-shy-bar-axjulxqh / neondb after verifying its exact endpoint mapping. The catalog confirms 77 migrations and 38 enabled/forced tables. The complete synthetic hosted workflow rehearsal passed with the restricted runtime role, including audit append isolation, mutation/read denial and rollback. Provider staging and production are unchanged.

## Quote policies — migration 0077

Source RLS reaches 39 of 47 tables. Active rider owners can insert/read their fare quotes; lock-only policy supports booking without allowing snapshot mutation. Backend matching/acceptance uses an exact associated-ride read scope. Compatible quote creation/preview transactions and scope resets must deploy before migration. Local verification passed 731 server, 208 API and 13 database tests. Hosted verification remains 38 tables through 0076; provider staging and production are unchanged.

Hosted quote verification: 0077 is applied on the disposable rehearsal branch; catalog confirms 78 migrations and 39 enabled/forced tables. Restricted-role quote creation, preview, booking lock, exact-ride reads, foreign/unscoped access denial, immutability and disabled-owner denial passed with synthetic maps. Provider staging and production remain unchanged.

Ledger preparation: journal/posting inserts now use a shared transaction-bound append helper across financial services, preserving existing authorization/idempotency checks and database balance constraints. This is preparation only; ledger_journals and ledger_postings still require policies and a versioned migration. Local server/API regressions passed; hosted coverage remains 39 tables.

## Ledger policies — migration 0078

Source RLS reaches 41 of 47 tables. Exact payment and closure-owner read scopes, current-transaction journal visibility and exact append payloads protect ledger headers/postings. Capture sweep permits source-specific capture headers. Existing deferred balance, immutable history and same-transaction posting constraints remain active. Backend authorization and compatible scope binding must deploy before migration.

Local verification passed 734 server, 208 API and 13 database tests plus typechecks and lint. The initial direct loss-policy test was updated to include the ledger scope already bound by the production service. Hosted verification now includes 0078: 79 migrations and 41 enabled/forced tables. The complete synthetic workflow rehearsal passed, including ledger payment/owner isolation, mutation denial, empty-journal rejection, financial retries, and closure/document checks. Provider staging and production are unchanged.

## Offer policies — migration 0079

Source RLS reaches 42 of 47 tables. Own-driver, accepted-rider, exact-ride matching/lifecycle, exact-notification and authorized-cleanup scopes protect offers. Matching retains pending-offer visibility for contention checks, while writes remain scoped to its ride. Compatible service transactions and scope resets must precede migration.

Local verification passed 736 server, 208 API and 13 database tests plus types/lint. Driver activity keeps its previous NOT_FOUND response for missing/disabled accounts. Hosted verification remains 41 tables through 0078 until the next isolated offer workflow check; provider staging and production remain unchanged.

Hosted offer follow-up: migration 0079 is present on br-shy-bar-axjulxqh / neondb; catalog confirms 80 migrations and 42 enabled/forced tables. The complete restricted-role synthetic rehearsal passed, including offer participant isolation, exact notification read-only scope, messaging, notification suppression, tracking, financial processing and reviewed cleanup. A separate local restricted-role service regression passed concurrent matching, offer privacy, driver acceptance and idempotent retry. All three offer-policy tests, server types and changed-test lint passed. Provider staging was rechecked read-only and remains 32 tables with RLS disabled; production is unchanged. Five core tables remain before compatible staging rollout.

## Outbox append preparation

A local-only policy prototype and unused enqueue helper now verify exact append scope, scheduled work, strict/conflict-ignored retries, rollback, and denied unscoped/forged writes. PostgreSQL duplicate suppression needs exact deduplication-key visibility while appending; scope clearing denies later reads. Three restricted-role tests, server typechecking and changed-file lint pass. No outbox migration or existing caller change has been applied. Worker leasing, acknowledgement, queue wakeup, notification reads and authorized dead-letter recovery must be scoped and tested before enabling outbox RLS. Hosted coverage remains 42 of 47; provider staging and production are unchanged.

Outbox caller integration: all 21 single-job insert sites now use the validated enqueue helper, preserving payloads, deduplication and schedules within existing authorized transactions. Full local checks passed: 740 server, 208 API, 13 database tests, server types and changed-source lint. The bulk document-cleanup INSERT SELECT is intentionally retained to avoid per-item round trips for manifests of up to 10,000 entries; its policy must authorize only the approved plan's matching jobs. Worker leasing/acknowledgement, read scopes and staff retries still need integration before a migration enables RLS. Hosted coverage remains 42/47; no hosted policy changes occurred in this checkpoint.

## Outbox policies — migration 0080

Source RLS reaches 43/47 tables. Deploy compatible enqueue, worker, notification and staff-recovery scopes before enabling the policy. Single inserts bind exact payloads and schedules; conflict reads use the exact deduplication key. Claim scopes select eligible work and bind its new lease; acknowledgements require the exact job and token. Wakeup and notification reads grant no updates. Identity retry and document cleanup require current staff MFA/permission and exact request or approved-plan scope. Bulk document insertion remains one query. Domain authorization, lease fencing and idempotent handlers remain required.

Local verification passed 744 server, 208 API and 13 database tests plus server/database types and changed-source lint. The actual migration is covered by restricted-role append/worker tests and existing account/document workflow suites. Hosted remains 42 tables through 0079 pending the isolated migration/check. Provider staging and production are unchanged; four core tables and compatible staging rollout remain, alongside native/provider acceptance.

Hosted outbox verification: 0080 is applied only on the reverified disposable br-shy-bar-axjulxqh / neondb branch. The catalog confirms 81 migrations and 43 enabled/forced tables. The complete restricted-role hosted rehearsal exited successfully, including synthetic financial processing, messaging, notifications, tracking and reviewed cleanup. Its new outbox checks passed exact notification read-only scope, unscoped denial, deduplicated enqueue and failure/retry/acknowledgement for one newly created synthetic job. Existing pending jobs were not dispatched. Source and isolated-hosted coverage now match at 43/47; users, drivers, rides and payment_attempts remain. Provider staging/production and real-device/provider acceptance remain outstanding.

## Payment-attempt read preparation

The shared customer resolver now establishes an exact source plus attempt/ride/intent read scope before reading the persisted payment binding. This is compatible preparation only; payment_attempts has no deployed RLS migration yet. Three local restricted-role prototype tests cover exact/foreign source selection, duplicate intent IDs across sources, missing-lookup clearing, read-only behavior and scope expiry. Full checks passed 747 server and 208 API tests plus server types and changed-source lint. Session/result writes, reconciliation, recovery sweeps, closure locks and dependent financial policies remain to be integrated before enabling the table. Source and isolated-hosted coverage remains 43/47; provider staging and production are unchanged.

Payment-attempt write preparation: both provider result binding and reconciliation now bind exact persisted attempt/ride/customer/source/amount and verified intent before writing. Read-scope replacement and identity resets clear write authority. The local read/write prototype has five passing tests, including foreign/retargeted write denial, amount protection and recording a verified in-flight result after owner disablement. All 749 server and 208 API tests, server types and changed-source lint passed. No payment-attempt migration is enabled; insert, sweep/closure and dependent-policy paths remain before versioned rollout. Source/isolated-hosted RLS remains 43/47, and provider staging/production are unchanged.

## Payment-attempt RLS migration 0081 — local verification

Deploy the compatible payment lookup, session/result, reconciliation, financial recovery and closure scopes before enabling this policy. Rider inserts require ownership and matching ride fare/customer binding. Result writes bind immutable local identifiers and verified intent. Internal recovery and durable-operation lookups can read within their configured provider source; ordinary backend lookups are exact-reference scoped. Accounting locks are exact-attempt scoped. Closure reads additionally require current staff MFA and privacy.close permission. Read/lock authority grants no data mutation. Transaction-local scopes are cleared by identity reset and scope replacement. Existing domain authorization remains required.

The actual migration passed eight focused restricted-role tests and the full 752 server, 208 API and 13 database tests, with typechecking and lint. Source coverage is 44/47; hosted remains 43/47 until isolated migration and rehearsal succeed. Users, drivers and rides remain. Provider staging and production are unchanged; do not toggle RLS manually or infer a deployed rollout from this source checkpoint.

Hosted payment-attempt verification: migration 0081 applied only to reverified disposable br-shy-bar-axjulxqh / neondb. Catalog confirms 82 migrations and 44 enabled/forced tables. The full restricted-role rehearsal passed, including payment lookup/source isolation and read-only lock behavior plus all synthetic financial, messaging, notification, tracking and reviewed cleanup flows. Source and isolated hosted coverage now match at 44/47. Users/drivers/rides and compatible provider-staging rollout remain. Provider staging and production are unchanged; physical-device and real-provider acceptance remain outstanding.

Identity preparation: API verified-subject lookups and public signup now use transaction-local identity scopes. User/default-driver creation is atomic and retries preserve existing roles; disabled accounts remain blocked. This compatible code must precede users/drivers policies, but does not enable them. Verified locally with 755 server and 208 API tests plus both typechecks and lint. Source and isolated hosted RLS remain 44/47, with provider staging and production unchanged.

Account-scope preparation: actor and command checks bind exact user IDs before reading persisted authorization state. Profile writes bind a full-row snapshot with only the requested name changed, within a locking transaction. A disposable restricted-role prototype verifies name-only writes and rejects identity/role/disabled changes, foreign reads and leaked authority. All 757 server and 208 API tests passed with server types and lint. These are compatible scopes only; users RLS is not enabled yet. Coverage remains 44/47; staff/worker account access and core-table policies still precede the provider-staging rollout.

Closure/recovery account preparation: reviewed account closure, retention locks, document cleanup barriers and payment-customer result recovery bind exact user lookups. Closure captures its immutable row with disabled=true before writing. Worker/actor resets and identity replacement revoke prior profile, signup and closure scopes. Verified by the full 757 server tests, three focused user-scope tests (including new actor-rebinding coverage), 208 API tests, server types and lint. These compatible changes do not enable users RLS; source/isolated hosted coverage remains 44/47 and provider staging/production are unchanged.

Driver account preparation: payout authorization, transfer eligibility and payout reconciliation bind exact driver user lookups in transactions. Background tracking resolves the account from the stored scoped grant before account checks; the client cannot supply an owner. All 758 server and 208 API tests passed, plus types/lint. All 15 tracking tests also passed with an exact-account users RLS prototype. This is local compatibility verification only; users/drivers/rides policies remain pending, coverage remains 44/47, and provider staging/production are unchanged.

Notification account preparation: notification queries bind the persisted rider/driver pair (at most two UUIDs), and device mutation account locks bind the verified actor ID. Scope changes/reset revoke prior audience authority. All nine audience tests pass under an exact-account users RLS prototype, including disabled-sender suppression and post-transaction invisibility. Full verification: 759 server and 208 API tests, server types and lint. Core users/drivers/rides migrations remain pending; coverage remains 44/47 and provider staging/production are unchanged.

## Users RLS migrations 0082–0084 — local verification

Deploy compatible identity/profile, account checks, document, payment, notification, tracking and closure callers before enabling users RLS. Normal reads use verified-subject or exact actor/account/audience scope. Assigned counterpart history and backend matching driver searches also have explicit read paths. Matching intentionally reads candidate driver accounts; it is not limited to one selected driver until ranking/acceptance. Profile/closure writes compare immutable row snapshots and allow only the intended name or disabled change. Closure still requires current service permission, MFA, financial and retention checks. Signup retries do not update existing users. No user DELETE policy is granted.

Closure workers briefly bind an exact request lookup to obtain the persisted owner, clear that lookup, and bind the owner before checking disabled state and dispatch safeguards. This breaks the initial account/closure visibility dependency without allowing arbitrary row mutations. Users related-party reads depend on rides; future rides policies must not introduce a users-policy recursion.

Full actual-migration verification passed 759 server, 208 API and 13 database tests, both server/database types and lint. Tests cover restricted-role signup, profile identity/role protection, tracking, notification suppression, reviewed document processing and closure/retention safeguards. Source coverage is 45/47; isolated hosted remains 44/47 until the next migration/rehearsal. Drivers and rides, compatible provider-staging rollout and physical-device/provider acceptance remain. Provider staging and production are unchanged.

Hosted users verification: migrations 0082–0084 applied only to the reverified disposable br-shy-bar-axjulxqh / neondb branch. Catalog confirms 85 migrations and 45 enabled/forced tables. The complete restricted-role synthetic rehearsal passed, including signup retries, immutable profile identity, disabled-account protection and the existing financial, tracking, messaging, notification and reviewed cleanup workflows. Source and isolated-hosted coverage now match at 45/47. Drivers/rides policies, compatible provider-staging rollout and native/provider acceptance remain. Provider staging and production are unchanged.


## Driver RLS migration 0085 — local verification

Deploy compatible driver, tracking, document/vehicle review, eligibility, payout reconciliation and account-closure callers with this migration. Driver mutations bind a locked row snapshot and an operation-specific field set; reads alone cannot mutate or delete drivers. Signup creates only default unapproved/offline drivers for verified active driver identities. Targeted worker/reviewer reads bind the persisted target account before driver locking. Scope resets revoke prior mutation authority. Domain authorization and freshness checks remain mandatory; these backend-controlled settings are not a defense against arbitrary SQL with a compromised runtime credential.

Local verification passed 764 server, 208 API and 13 database tests, server/database types, changed-source lint and diff checks. Restricted-role cases cover cross-driver isolation, protected-field updates, invalidation and scope reset. Source coverage reaches 46/47. Isolated hosted remains 45/47 pending migration/rehearsal. Rides RLS and restricted-runtime API auditing remain before coordinated provider-staging deployment. Provider staging and production are unchanged; do not manually toggle RLS there.


Hosted driver verification: migration 0085 applied only to the disposable br-shy-bar-axjulxqh / neondb branch after branch/endpoint checks. Catalog confirms 86 migrations and 46 enabled/forced tables. The complete synthetic workflow passed through the NOSUPERUSER/NOBYPASSRLS runtime role, including new driver scope checks. Source and isolated hosted now match at 46/47. Provider staging and production remain unchanged.

The rider live-location API must deploy with actor-scoped reads before these policies reach provider staging. Restricted-role tests verify that assigned riders receive fresh samples through pickup and in-trip states, while stale samples, disabled accounts and ended assignments remain protected. All 209 API tests, API types and changed-source lint passed. Rides RLS and the remaining API read audit precede coordinated rollout.
