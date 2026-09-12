# Staff-authorized refund operations

## Scope and access

`POST /v1/staff/rides/:id/refunds` accepts the shared `RefundAuthorization` contract: integer USD cents, a bounded reason code and a policy reference. It requires an active staff account, verified MFA, the database permission `payments.refund`, and an `Idempotency-Key`. Public signup cannot grant this permission. Replayed requests still check current staff authorization. `GET` on the same route returns up to 100 operation records newest first without provider identifiers or operation keys. The staff dashboard belongs in its separate repository and can consume these shared contracts.

The policy reference records the staff decision; the service does not invent automatic refund eligibility, customer promises or driver liability. Refunds return through the original payment's provider operation, never to a caller-supplied destination. Cancellation is not implicit refund authorization.

## Durable execution

Authorization locks the payment attempt and requires a capture journal matching a provider refund check no older than five minutes. Current pending, action-required and succeeded refunds reserve funds. Failed and canceled refunds do not reserve funds after verified observation. An unresolved existing operation blocks another authorization, including from another staff account. The decision, audit entry, command response and execution outbox job commit atomically.

The worker refreshes current provider history before its first mutation, checks the captured-funds limit again, and persists its first-attempt timestamp before contacting Stripe. All retries use the same UUID-derived provider operation key. A lost response must replay that key even if a refund is already visible in provider history. A database failure after provider success likewise retries the original key. Successful response binding and the follow-up reconciliation job commit together. Duplicate deliveries cannot change the bound provider refund identifier.

`submitted` means Stripe returned an identifiable refund, not that the money reached the customer. Rider receipts use the separate verified observation path. Authorization amount, staff, reason, policy reference, creation time and first attempt are protected against rewriting; deletion is rejected. A separate accounting flag now adds verified processor balance journals without reversing driver earnings; see [refund accounting](68-refund-accounting.md).

## Uncertain outcomes and review

An unresolved operation at least 23 hours beyond its first attempt becomes `review_required` without another provider mutation. This leaves headroom before Stripe may prune idempotency records after at least 24 hours. Never reissue an old uncertain request under a new key. Verify the provider outcome and matching persisted operation through controlled financial review. Metadata-based read-only recovery and an authenticated recovery endpoint are now implemented; see [correlation recovery](68-refund-accounting.md). Uncorrelated/contradictory cases still require controlled provider-support review. Keep production mutation enablement off until financial workflows and provider acceptance are complete.

External dashboard refunds can occur between history retrieval and mutation; Stripe remains the final cumulative refund limit. Provider exceptions preserve the reservation and retry history instead of assuming no money moved. Worker dead letters and review-required operations need operational monitoring. No automatic driver loss allocation is selected.

## Setup order

1. Deploy the optional receipt compatibility changes and apply migrations 0031 and 0032 explicitly through the environment migration procedure.
2. Configure and verify the signed refund webhook events and worker recovery described in [refund tracking](66-refund-tracking.md).
3. Set `PAYMENT_REFUNDS_ENABLED=true`. Keep `PAYMENT_REFUND_OPERATIONS_ENABLED=false` until the policies, staff permissions, review operations and provider acceptance are ready.
4. Test dedicated sandbox payments and authenticated MFA staff access. The refund key needs refund-creation access as well as existing retrieval permissions. Configure no live credentials for local tests.
5. After approval, set `PAYMENT_REFUND_OPERATIONS_ENABLED=true` on both API and worker. Tracking must also be enabled; invalid or incompatible flags fail configuration validation.

Both flags default off. No migration runs at startup/build. Disabling mutations removes the HTTP capability and execution handler: inspect and retain queued work deliberately before disabling the worker. Never delete financial records or replay pending mutations with replacement keys during rollback.

## Local verification

Disposable PostgreSQL tests cover permissions, replay, concurrent reservations, existing external refunds, stale checks, missing capture records, lost responses, bounded retries, immutable decisions, atomic enqueue and post-provider persistence failure. Authenticated API tests verify disabled capability, permission denial, command replay, safe listing and durable enqueue. All provider calls in these tests use synthetic mocks. This does not prove hosted sandbox, live refunds, physical payment acceptance or a complete production financial workflow.

## Remaining financial work

Metadata recovery and processor refund/failure journals are now implemented. Remaining: review of uncorrelated/refused outcomes, allocation of refund suspense under approved policy, dispute processing, driver transfer/settlement and their authorized review workflows before enabling production mutations. Commercial policy, liability and provider setup remain final owner decisions.

## Provider references

- [Stripe refund creation](https://docs.stripe.com/api/refunds/create)
- [Stripe idempotency and retention](https://docs.stripe.com/api/idempotent_requests)

## Disputed-payment hold

When dispute tracking is enabled, authorization and each provider-mutation attempt require fresh clear dispute records. The worker refreshes disputes before applying the hold. Read-only recovery can still bind an existing correlated refund. See [dispute safeguards](69-disputes.md).
