# Payout account events and eligibility freshness

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

## Current-state reconciliation

Stripe account notifications now enter a dedicated `POST /webhooks/stripe-connect` endpoint. This accepts Accounts v2 thin events, separate from the existing payment snapshot endpoint. The installed SDK verifies the raw payload, signing secret and five-minute signature tolerance. The adapter validates test/live mode and extracts only event ID/type/time and account ID. It never follows a webhook-supplied resource URL or copies raw identity/bank details into storage.

Subscribe to these thin event types on the intended platform account:

- `v2.core.account.created`
- `v2.core.account.closed`
- `v2.core.account.updated`
- `v2.core.account[configuration.recipient].capability_status_updated`
- `v2.core.account[configuration.recipient].updated`
- `v2.core.account[requirements].updated`

Receipt and `payout.reconcile` outbox work commit atomically. Identical retries do not duplicate work; a conflicting signed event with the same ID is rejected. A failed enqueue rolls back the receipt so delivery can retry. A separate `STRIPE_CONNECT_WEBHOOK_SECRET` is required when onboarding is enabled; it cannot equal the payment webhook secret. Missing configuration returns 503 rather than acknowledging an event that cannot be processed.

The worker looks up the account only through a binding in the configured platform/mode. Unbound account notifications are ignored without a provider request. Account provisioning therefore also enqueues initial reconciliation atomically with its mapping, covering an account-created notification that arrives before the mapping exists. Existing bindings are recovered by the periodic sweep.

Each reconciliation fetches the account's current capabilities through the adapter, with account ID, driver/binding metadata and mode verification. Event payload status and event ordering never directly enable driving. A database revision fences competing reads: an older response, whether success or failure, cannot overwrite a later check. Provider failure records unavailable status, revokes payout readiness and lets the durable job retry.

## Expiring payout eligibility

Migration `0021_payout_account_reconciliation.sql` adds payout-account synchronization fields, a minimal webhook inbox and `drivers.payout_valid_until`. There is no production backfill of readiness. An existing driver with a legacy readiness flag but no verified expiry cannot accept new work until a fresh check succeeds.

Verified active recipient transfer and payout capabilities grant a maximum one-hour payout eligibility window, measured from the start of the provider request. Inactive/pending capabilities, invalid provider responses, disabled accounts or provider failures revoke the payout flag and expiry. The worker does not grant vehicle/document approval, alter approval expiry, move money or record a bank payout. All independent driver approval requirements still apply.

Driver profile, going online, offer visibility, candidate selection, final offer creation and offer acceptance enforce the payout expiry. Matching expires pending offers whose eligibility has lapsed. This prevents a missed webhook or stopped worker from preserving readiness indefinitely.

An accepted trip is not abandoned solely because payout capabilities change: its normal trip transitions and tracking continue. The worker preserves the driver's online flag and existing assignment, while blocking new assignments. Support and payout remediation must remain available. The final transfer worker must re-check the provider immediately before transferring money; the one-hour driving eligibility window is not authorization to transfer funds.

## Worker recovery and hosting

The existing authenticated recovery cron now enqueues stale payout bindings every 30 minutes, in batches of at most 100 with locked-row skipping and time-bucket deduplication. The queue worker handles reconciliation alongside existing ride/payment jobs. Successful Connect notifications and payout setup mutations trigger a worker wakeup; the cron covers a failed wakeup publish. Work remains durable if the provider or queue is temporarily unavailable.

The Vercel rewrite configuration now forwards `/connect/:path*` to the API, in addition to `/webhooks/:path*`. This is required for hosted onboarding return/refresh pages; local Hono routing alone did not establish that deployment behavior. A tooling test covers both paths and the other public API prefixes.

Use isolated databases for each environment. Do not point simultaneous live and test deployments at the same driver records: payout source isolation is not a substitute for database environment isolation. Monitor overdue checks, dead letters, webhook failures and batch backlog before enabling real bookings. The bounded sweep is sized as initial infrastructure, not verified production throughput.

## Verification and release boundaries

Tests cover actual SDK signature verification using independently generated synthetic signatures, replay-window rejection, mode mismatch, concurrent duplicates, conflicting event references, transactional rollback, payload limits and unsupported events. PostgreSQL reconciliation tests cover delayed-response races, current capability checks, provider failure, disabled accounts, source mismatch, recovery sweep deduplication and worker execution.

Assignment regression tests verify expiry before candidate selection, offer visibility and acceptance, and continued transitions for an already accepted trip. Hosting tests verify worker wakeups, recovery ordering and Vercel callback rewrites. Browser regression uses synthetic payout eligibility explicitly seeded with an expiry; it does not fabricate a Stripe account.

Verification passed: 327 workspace tests, eight tooling tests, typechecking, lint, formatting, module boundaries, documentation checks and packaged API smoke. All seven browser journeys passed, including the full three-minute search timeout and a completed two-app trip.

No hosted migration, Stripe destination creation or live account mutation was performed. Real sandbox event delivery, deployment routing, queue/cron execution and physical-device onboarding remain to be verified. Transfers, payout settlement/reversals, disputes, monitoring/alerting and document approval remain separate unfinished requirements.

## Sources

- [Stripe thin and snapshot webhook handling](https://docs.stripe.com/webhooks)
- [Accounts v2 event types](https://docs.stripe.com/api/v2/core/accounts/event-types)
- [Driver payout onboarding configuration](56-driver-payout-onboarding.md)
