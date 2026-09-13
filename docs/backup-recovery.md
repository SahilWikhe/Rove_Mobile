# Database backup and recovery acceptance

This is the recovery procedure and evidence required before production activation. A local synthetic logical restore has passed as described below; a hosted Neon restore and external-provider reconciliation remain unverified. A successful migration, healthy API, database branch clone or configured history window does not prove recovery.

## Verified staging inventory — September 13, 2026

Read-only Neon API inspection of project `square-frost-35273983` returned:

- PostgreSQL 18, free plan, `history_retention_seconds=21600` (six hours).
- Provider staging `br-super-leaf-axpo6edu` (`rove-provider-staging`) is ready and has no parent in the branch response. Its snapshot schedule is empty.
- The project snapshot list is empty.
- The RLS rehearsal `br-shy-bar-axjulxqh` is a child branch, expiring September 14 at 08:13:45 UTC. It is not a durable backup.

No recovery settings, subscriptions, snapshots, branches or application endpoints were changed by this inspection. Production recovery has not been configured or verified. Recheck these live values when preparing a release; this inventory is dated evidence, not a monitor.

Neon's current [backup documentation](https://neon.com/docs/guides/backup-restore) describes billed snapshot storage and paid automatic schedules. Paid setup remains deferred under the owner's instruction. Choose the acceptable data-loss interval, recovery time, backup retention and budget before enabling a schedule or expanding history. Do not interpret the current six-hour window as an approved production policy.

## Local logical restore rehearsal — September 13, 2026

Run from the repository root with installed PostgreSQL 18 client tools:

```sh
ROVE_PG_CLIENT_BIN=/path/to/postgresql/bin pnpm db:restore:rehearsal
```

On this Mac the verified directory is `/opt/homebrew/opt/libpq/bin` (Homebrew libpq 18.6). This command accepts no database URL or target arguments. It creates a fresh embedded PostgreSQL server, applies repository migrations, inserts synthetic rider/driver records and dumps a custom-format archive. Client connections are restricted to this server's loopback address and fixed owned database names; ambient PostgreSQL settings are excluded. No cloud credentials or hosted database are used.

The command changes the source after the backup, restores the archive into a separate empty database and compares every public/drizzle table's records with the pre-backup state. For schema verification it independently parses the plain schema dump into a third empty database, then compares the canonical dumps including policies, grants and ownership. This accounts for PostgreSQL flattening equivalent nested boolean expressions when it reads its own dumped constraints. It also checks enabled/forced RLS on every application table and exercises unscoped, owned and unrelated-account reads and denied unrelated writes through an actual non-owner, NOSUPERUSER/NOBYPASSRLS runtime login.

Verified result: 48 application tables, all 89 migration journal entries, matching schema and pre-backup data, post-backup changes absent, and runtime isolation passed. The measured pg_restore phase was 148 milliseconds; this tiny synthetic dataset is not a production recovery-time estimate. A temporary fault-injected run changed a restored record, failed the data comparison and exited 1 after cleanup. The passing run exited 0. Result reporting occurs only after closing clients, stopping the owned server and removing temporary archives; failures preserve a nonzero exit status despite the embedded server's exit hook.

The databases share one disposable server and its locally created runtime role. Logical database archives do not establish recovery of cluster roles, provider configuration or external state. The fixture now includes a completed synthetic ride, captured funds, balanced capture/allocation journals, an owned receipt and a pending payment-review case. After restore, restricted services verify receipt ownership, journal balance and deletion denial, reconciliation retry without duplicate journals, review intake/acknowledgment retries and absence of a post-backup acknowledgment. The payment provider is an in-memory synthetic adapter; it makes no network requests. Most other tables remain empty. Active trips, general outbox replay, external financial outcomes, later closures/holds/erasures, physical devices and Neon point-in-time recovery remain covered by the required acceptance scenarios below, not by this local result. No paid storage or backup schedule was enabled.

## Prepare an isolated restore rehearsal

1. Record the source project, root branch, database names, code SHA, complete migration journal, restricted runtime role and selected recovery timestamp/LSN or snapshot ID. Confirm the source contains only authorized synthetic test data for a rehearsal.
2. Check the source is supported by the selected recovery mechanism. Current [instant-restore documentation](https://neon.com/docs/introduction/branch-restore) limits history-based restore to root branches. Do not assume a disposable child supports it. Confirm that the recovery point remains within retained history.
3. Create or select the approved recovery snapshot only after its cost/setup decision. Use the [snapshot restore controls](https://neon.com/docs/cli/snapshots) to restore into a separately named inspection branch. Inspect the resolved source and destination IDs before submitting; do not select provider staging or production as an overwrite target. Do not finalize a name/compute swap during the rehearsal.
4. Keep the restored branch disconnected from deployed APIs, cron, queue consumers, WebSocket services and mobile builds. Do not copy its credentials into a linked production project. Restoring a database does not restore or roll back Auth0, Stripe, AWS documents, Expo deliveries or Vercel queues.
5. Assign an expiration to disposable recovery resources and record it. Retain only redacted results, not database dumps, credentials or account content in GitHub artifacts. Never use an expired rehearsal branch as backup evidence.

## Verify before enabling any writes or workers

Connect directly with the reviewed inspection/migration role first, then separately with the restricted runtime role. Inspect every database affected by a branch restore. Use read-only transactions for initial inspection.

| Check | Required evidence |
| --- | --- |
| Recovery point | Recorded snapshot/time/LSN, operation completion, distinct restored branch/endpoint and measured restore duration |
| Migration state | Complete journal hashes match the reviewed source prefix; no missing or unknown entries. Use the migration planner only with its intended environment and target checks |
| Schema and RLS | Schema comparison; every expected application table has enabled and forced RLS and its expected policies; runtime owns no application table and has no superuser, BYPASSRLS or inherited migration authority |
| Restored data | Synthetic records committed before the chosen point exist with expected content; changes committed after the point do not appear. Counts alone do not establish this |
| Account isolation | Authorized rider/driver reads work; unscoped and unrelated-account reads fail through the actual restricted runtime role |
| Financial invariants | Journals balance; restored capture/refund/transfer references are reconciled to provider outcomes before new financial work is admitted |
| Deletion and holds | Post-recovery-point closures, holds, identity removals and erasure outcomes are accounted for before any account is reactivated or data served |
| Operational queues | Review restored outbox and provider-event state against external deliveries; do not automatically replay every pending row |

The deployed staging catalog currently has 48 application tables and 89 migrations through 0088. Derive expected tables and journal entries from the selected release commit when executing the drill; these numbers are not permanent acceptance constants.

## Reconcile changes outside the restored database

A restore can bring back a database row for an identity already removed from Auth0, or a pending command whose payment already succeeded. PostgreSQL cannot infer those external outcomes.

Keep a recovery record outside the timeline being restored containing approved closure/hold/erasure references and unresolved external operations. Define its access controls, retention and ownership before launch. A row or audit event stored only in the restored database is not sufficient evidence for events after the recovery point. This independent record and automated deletion replay are not implemented or verified by this runbook.

Use existing provider reconciliation paths with the original operation identifiers and idempotency keys. Never create a new payment/transfer key to recover an uncertain old operation. Verify expired provider idempotency windows explicitly; do not assume retry deduplication lasts indefinitely. Preserve confirmed external outcomes even when newer database state was lost. Missing evidence requires review, not automatic retry or a success claim.

Before reconnecting clients, account for revoked sessions, disabled accounts, driver tracking grants, push installations and active-trip assignments. Check external webhook and queue deliveries that occurred after the restore point. A database restore must not resurrect a driver's location-sharing permission or an erased account's access.

## Required synthetic acceptance scenarios

- Restore before a capture was recorded locally but after the provider accepted it: reconcile exactly one capture and one matching ledger outcome, without charging again.
- Restore before a completed refund or driver transfer/reversal was recorded: preserve the provider outcome and balanced accounting without another transfer of money.
- Restore before an account closure or document/message erasure: keep that account inaccessible, respect later holds and apply the reviewed suppression/erasure recovery process before serving restored data.
- Restore with pending/leased outbox work and already-delivered notifications/webhooks: recover deliberately without duplicate financial effects or unsupported notification replay claims.
- Reconnect the rider and driver after reconciliation: verify Auth0 access, messaging, location authorization, trip recovery and closed-trip restrictions on the restored candidate.

These scenarios remain outstanding with actual provider-backed evidence. Fake adapters or migration tests alone do not complete them. Use authorized synthetic provider accounts and test-mode money only during rehearsal.

## Production recovery decision

After a successful isolated rehearsal, record the approved outage/data-loss objectives, measured recovery result, reconciliation evidence and exact candidate. Production overwrite or promotion remains a separate explicit release/incident action. Quiesce all writers before the approved cutover, preserve the pre-cutover state, verify the destination and recheck runtime permissions after reconnecting. Gradually restore worker and client traffic only after reconciliation passes.

Follow [production setup](production-setup.md), [migration controls](production-migrations.md), [retention holds](76-retention-holds.md) and [document cleanup](77-document-cleanup-plans.md). Retain the previous endpoint/deployment references and the rollback decision. Do not automatically reverse database migrations or external financial effects.
