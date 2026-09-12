# Production database migrations

`pnpm db:production:migrate` is an operations command. It never runs in application startup or Vercel builds. Production database creation, role provisioning, backup verification and release approval remain separate setup steps. No production database is configured by this command.

## Prepare a release

Use a clean checkout of the exact release SHA after CI and staging acceptance. Review all pending SQL for compatibility with the currently deployed API and mobile clients. A plan hash confirms unchanged inputs; it does not decide whether SQL is safe or replace release approval.

Provision a separate production project/database and a dedicated migration login. Create a restricted runtime role that cannot inherit the migration role. Configure appropriate schema/table/sequence privileges and default grants separately. Verify the production endpoint in the provider console and confirm backup/restore coverage before applying changes. This command checks the configured target and connected database/role, but cannot prove provider project isolation or backup readiness.

Create one ignored, permission-restricted environment file with these fields:

```dotenv
ROVE_ENVIRONMENT=production
PRODUCTION_DATABASE_HOST=<verified-direct-Neon-host>
PRODUCTION_DATABASE_NAME=neondb
PRODUCTION_MIGRATION_ROLE=<migration-role>
PRODUCTION_RUNTIME_ROLE=<restricted-runtime-role>
PRODUCTION_MIGRATION_DATABASE_URL=postgresql://<migration-role>:<password>@<verified-direct-Neon-host>/neondb?sslmode=verify-full
```

Use a direct connection, never a pooled hostname. Do not put this credential in API runtime or mobile environments. Only this explicit file supplies connection settings; ambient database credentials are ignored.

## Plan and apply

```sh
pnpm db:production:migrate plan /private/path/production-migration.env
pnpm db:production:migrate apply /private/path/production-migration.env <reviewed-plan-hash>
```

The plan performs database reads in a read-only transaction and reports the target, recorded count, pending migration tags/checksums, and plan hash. It creates no schema or journal. Review that output alongside the SQL and release SHA.

Apply reacquires a database-scoped advisory lock and validates the complete recorded migration prefix. Unknown, changed, missing or reordered journal entries are rejected. Historical timestamps are preserved; journal order and checksums determine progress, including older migrations whose timestamps are not monotonically increasing. A populated database without a migration journal is rejected rather than assumed safe to initialize.

The plan hash binds the destination identity, complete source migration list and existing database journal. If any changes after review, generate and review a new plan. Concurrent migration attempts fail promptly. DDL lock acquisition is bounded to ten seconds and individual SQL statements to sixty seconds.

All pending SQL and journal inserts run in one transaction. Failure rolls back that transaction. Do not add migrations that require execution outside a transaction, such as concurrent index creation, without a separately designed release path. SQL itself is trusted reviewed repository code; the runner is not a SQL sandbox. Error output deliberately withholds raw database details and credentials.

After success, run plan again to confirm no pending entries, then verify runtime-role access and API compatibility before deploying. A plan is not a full schema-drift detector: it validates the recorded history, not every live column or manual alteration. Do not manually repair migration hashes to make a divergent database pass.

Rollback normally means a compatible application rollback or reviewed forward database repair. This command does not run down migrations or undo provider side effects.

## Rehearsal evidence

Automated tests use isolated local PostgreSQL databases and exercise the full versioned migration set, read-only planning, safe rerun, stale-plan rejection, tampered history rejection, concurrent locks, destination mismatch, role inheritance rejection and transactional rollback after a deliberately failing SQL statement. These tests do not establish production backup, provider permissions or real deployment readiness.
