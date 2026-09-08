# Neon staging setup

## Current environment

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

Vercel hosting, managed authentication, real Stripe sandbox credentials/webhooks, maps and notifications remain separate integrations. A deployed backend should receive only the pooled runtime URL; migration credentials belong in a separately controlled migration job. Real production setup, backups/recovery rehearsal, load/cold-start behavior and physical-device journeys are still unverified.
