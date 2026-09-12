# Dispute verification, accounting and staff review

## Provider verification

The Stripe reader verifies the persisted platform account/mode, PaymentIntent, customer, ride, attempt, currency and amount before listing disputes for that intent. It follows explicit cursors with at most ten pages of one hundred disputes. Duplicated IDs, truncated histories, mismatched references, invalid statuses, currencies and balance arithmetic fail verification. Both current `du_` and legacy `dp_` dispute identifiers are accepted.

Stored facts include status, reason code, disputed amount, creation time, response deadline and normalized processor balance transactions. Raw customer evidence, contact information, payment-method details and arbitrary metadata are excluded. The reader never accepts a dispute, submits evidence, creates a refund or transfers funds.

## Signed event and recovery flow

Enable `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn` and `charge.dispute.funds_reinstated` on the existing platform Stripe webhook endpoint. Signature, timestamp, account mode and connected-account exclusion checks still apply. Event amounts/statuses are hints only; linked PaymentIntent identity queues `dispute.reconcile` atomically with event deduplication. Valid legacy events without a PaymentIntent are ignored.

The worker reads current complete provider history outside the database transaction. It verifies references again and uses revision fencing before committing current checks and immutable changed-fact observations. An older overlapping read cannot replace newer state. Previously recorded financial references cannot disappear or change. Provider or ledger failures retain the last verified record and retry through the outbox.

Recovery scans at most 100 paid/review-required attempts whose dispute check is unverified or older than one hour. Requested timestamps prioritize untouched work and defer reselection for ten minutes. Hour-bucket deduplication limits repeat wakeups. Signed events and authorized staff refreshes can verify earlier. This is not a fixed delivery or deadline-response SLA; monitor failed/dead-letter jobs and approaching evidence deadlines.

## Processor accounting

Migration 0034 adds `dispute_suspense` and immutable dispute observation tables. Verified adjustment transactions post their net impact to `stripe_clearing`, the opposite gross amount to `dispute_suspense`, and fees/credits to `processor_fees`. Every journal is balanced and keyed by source account/mode plus provider balance transaction. Duplicate reads do not duplicate postings; a reinstatement adds a new journal rather than changing a withdrawal.

The captured-payment journal must match verified received funds before dispute movements are recorded. Ledger entries and observations commit together. Missing capture/financial evidence or persistence failure rolls back the new observation. A won status alone does not restore processor funds. Original capture, driver earnings and gross revenue remain unchanged; suspense and loss allocation require an approved policy and review workflow.

## Staff endpoints

Both endpoints require an active staff account, verified MFA and the explicit database permission `payments.dispute.review`:

- `GET /v1/staff/disputes` returns up to 50 current dispute summaries ordered by response deadline, then stable payment/dispute identifiers. Optional `status` filters use the shared dispute-status contract. Follow `nextCursor` with the same filter for subsequent pages. The queue includes closed cases; use filters to focus operational work.
- `POST /v1/staff/rides/:id/disputes/refresh` retrieves current provider facts for that ride. It performs no provider mutation.

The shared `StaffDisputeQueue` contract includes ride reference, dispute identifier, status, reason code, amount, due/verification timestamps and a conservative `settlementBlocked` indicator. It excludes processor balance details, customer evidence and PaymentIntent/customer identifiers. The internal dashboard belongs in its separate repository; this repository exposes backend use cases and contracts.

## Refund safeguard and settlement limits

When dispute tracking is enabled, staff refund authorization requires a fresh dispute check. Unknown/stale history, open/lost disputes and unresolved net deductions block refund creation. The refund worker refreshes disputes and rechecks the hold before any mutation, including an uncertain-key retry. Metadata-based read-only recovery of an already-created refund remains possible.

The queue indicator is not authorization to transfer money. Future driver settlement must apply current dispute, refund, suspense, payable and provider eligibility checks together. A closed case with unreturned fees remains financially unresolved. Dispute evidence submission, acceptance and commercial loss allocation are not performed automatically; handle evidence through the provider's controlled staff workflow until an accepted audited integration exists.

## Rollout

1. Apply migration 0034, including all preceding migrations, through the explicit environment migration procedure. Never migrate during startup/build.
2. Provision matching platform-account/test-mode Stripe read permissions for disputes and balance records. Add the five event subscriptions above while retaining payment/refund subscriptions.
3. Deploy API and worker code, then set `PAYMENT_DISPUTES_ENABLED=true` on both. It defaults off; invalid boolean values fail configuration validation. Disabled deployments neither register the handler nor query the new dispute tables.
4. Grant MFA finance reviewers `payments.dispute.review` explicitly. Staff who authorize refunds may also need this permission to refresh/review a stale dispute check.
5. Verify dedicated sandbox dispute creation, updates, deductions, deadlines, reinstatement, duplicate delivery and missed-event recovery. Confirm who owns evidence deadlines, provider notifications and failed-job review before production activation.

No real provider request, monetary change, cloud migration or permission/flag update occurred during local implementation. Keep production activation subject to the broader release gates, provider acceptance and commercial decisions.

## Verification

Disposable PostgreSQL tests cover balanced deduction/reversal journals, unknown/stale/uncleared holds, immutable history, mismatched/disappearing records, concurrent stale responses, transactional failure/retry, protected filtered queue pagination and recovery deduplication. Adapter tests cover complete pagination, account/reference validation, evidence minimization and balance validation. A signed HTTP event test runs through the real inbox/outbox worker to financial records and the staff queue; a false won status in its event cannot override provider truth. Refund tests verify a newly discovered dispute blocks execution before a provider mutation.

## References

- [Dispute object and deadlines](https://docs.stripe.com/api/disputes/object)
- [Dispute listing and payment filtering](https://docs.stripe.com/api/disputes/list)
- [Balance adjustments for disputes and reinstatements](https://docs.stripe.com/reports/balance-transaction-types)

## Payment loss allocation checkpoint

The protected, audited allocation API is implemented locally behind a default-off flag. See [payment loss allocation](70-payment-loss-allocation.md) for signed balances, policy requirements, migration 0035 and remaining net driver earnings/transfer integration. No hosted rollout or production settlement acceptance is implied.
