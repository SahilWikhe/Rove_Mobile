# Payment provider boundary

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

The server now has a `PaymentProvider` interface and a Stripe adapter for authorization sessions, status retrieval, capture, cancellation/release and partial refunds. Stripe is implemented as a candidate integration; the merchant/Connect charge model and commercial responsibilities still require the final business decision. No live account was created or charged.

## Intended ride flow

Create a PaymentIntent with manual capture and server-owned fare/customer/ride/attempt identifiers. Return its client secret only through an authenticated owner-only endpoint to the native payment UI. That UI must handle authentication such as 3DS. Creating the intent alone does not authorize it. Before starting matching, the domain must retrieve and verify `requires_capture` with enough capturable funds. [Stripe authorization and capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)

After completion, capture the approved amount with the persisted provider operation key. For cancellation/no-driver outcomes, cancel an uncaptured intent under the approved fare policy. A captured payment requires an explicit refund decision; cancellation does not silently issue a refund. Refunds can remain pending and must not be recorded as settled solely because creation returned successfully.

The adapter pins Stripe SDK 22.6.1 and API version `2026-08-26.dahlia`, with ten-second request timeout and two network retries. Every mutating call requires an explicit stable idempotency key. The [payment-session service](29-payment-session-creation.md) now persists intent creation attempts before provider calls and reuses their keys for uncertain outcomes. Customer provisioning is now journaled too; see docs/30-payment-customer-provisioning.md. Refund operation records remain to be implemented. Stripe may prune idempotency records after at least 24 hours: an old unresolved creation must not be retried blindly after that retention window. [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests)

The adapter requires a server-configured `paymentMethodConfiguration` (`pmc_...`). Create a dedicated configuration for ride authorizations in each Stripe environment and enable only reviewed methods compatible with native PaymentSheet and manual capture. The adapter passes this configuration to Stripe and never hardcodes `payment_method_types`. Changing method availability is a Dashboard setting; it must still pass the sandbox authorization/capture/SCA test matrix before launch. This does not enable any methods or modify the connected account automatically. [Stripe payment method configurations](https://docs.stripe.com/payments/payment-method-configurations)

## Native recovery after a closed request

The payment screen treats cancelled, no-driver-found and terminated rides as closed even when an authorization is still awaiting release. It must not report those rides as confirmed or offer another payment attempt. Cancelled and no-driver-found requests offer route review for a new quote; opening that review does not create a ride or charge. Payment release remains a separate server/provider state, and stale sheet-dismissal notices must not say a closed ride is awaiting payment.

## Verification at the boundary

Each normalized intent is checked against the persisted intent, customer, ride, payment-attempt identifier, amount, currency, manual-capture mode and test/live mode. Capture, release and refund retrieve this reference before mutation. Already captured/canceled results are reconciled without issuing the same side effect again. Capturing beyond the original or available amount is rejected. Refunds cannot exceed the currently received amount; cumulative refund uniqueness and ledger limits also belong in the financial domain.

Only integer USD minor units are supported initially. Intent creation requires at least 50 cents; partial capture/refund inputs can be smaller positive amounts and remain subject to provider acceptance. Business pricing must be reviewed separately. No destination-transfer, application-fee, driver-payout or merchant-of-record model is silently selected by this adapter.

Provider errors are mapped to a safe unavailable response without exposing request/card details or client secrets. Normalized payment snapshots never contain a client secret. Creation returns that secret separately for the future owner-only payment session response; it must never enter audit logs, outbox payloads or client analytics.

## Webhook verification

The adapter verifies the signature against the exact raw body with the Stripe SDK, checks a five-minute timestamp window in both directions, enforces the configured test/live mode, rejects connected-account events on this platform-only adapter, and bounds body/signature size. It returns only event id/type/time/resource id. Do not parse/re-serialize the body before verification.

A verified event is a reconciliation hint. The webhook endpoint now durably deduplicates event ids and enqueues processing; see [durable webhook ingress](27-payment-webhook-ingress.md). The [reconciliation worker](28-payment-reconciliation.md) now retrieves current provider state before applying funding transitions, with revision checks against overlapping responses. Runtime composition is implemented; production configuration and acceptance remain required. Duplicate/out-of-order events must not double-capture, double-refund or regress a settled state. [Stripe webhooks](https://docs.stripe.com/webhooks)

## Executed tests and remaining integration

Nine adapter tests use mocked Stripe API methods; webhook tests use the real SDK's signing and verification helpers with synthetic secrets. They cover request parameters, key propagation, credential modes, invalid amounts, reference mismatch before mutation, capture/release retries, action-required/underfunded state, partial pending refunds, safe errors and signature/timestamp/tampering checks. No sandbox network charge has been verified yet.

Customer provisioning, durable payment sessions, native PaymentSheet/CustomerSheet, saved methods, capture/allocation ledger, receipts, earnings and runtime/worker composition are implemented; see [native payments](31-native-rider-payments.md), [ledger](32-captured-funds-ledger.md), [earnings](37-driver-earnings.md) and [runtime](34-backend-runtime.md). Remaining: complete physical-device PaymentSheet/3DS and sandbox journey acceptance, refund/dispute authorization and journals, actual driver transfers/settlement, periodic reconciliation/review operations, retention and approved production policies. Staging evidence is not production activation.

## Refund-history provider boundary — September 12

`RefundProvider.refunds(reference)` now reads current Stripe refund facts for a persisted payment reference. The Stripe adapter first verifies the intent's account mode, customer, ride, attempt and amount, then requests refund pages filtered by that PaymentIntent. It follows explicit cursors with at most ten pages of one hundred entries. Truncation, duplicate IDs, empty advancing pages, invalid statuses/currencies/references and amounts exceeding verified captured funds fail closed instead of returning a partial total. Pending and action-required amounts are distinct from succeeded refunds; failed/canceled attempts do not count toward the committed amount. Returned records contain only refund ID, intent ID, amount, status and creation time.

This uses Stripe's [refund listing](https://docs.stripe.com/api/refunds/list) and [refund object](https://docs.stripe.com/api/refunds/object) contract. The adapter does not infer that an old embedded list is complete, log provider payloads, create refunds or allocate losses. The list is a provider observation, not an atomic snapshot with concurrent external refund creation; durable reconciliation must use retry/version fencing and later events.

All fifteen Stripe adapter tests passed, including four added history cases for pagination, field/reference checks, duplicated pages, pending/failed totals, bounded reads and sanitized errors after a partial response. Workspace/E2E typechecks, changed-source lint, import boundaries and packaged API runtime checks passed. No provider network request or financial mutation occurred.

The subsequent durable checkpoint below adds observations, webhook/recovery orchestration and owned receipt presentation. Refund authorization and financial journals under the approved policy remain next.

## Durable refund tracking

The provider history boundary is now consumed by the flagged durable worker and rider receipt path. See [refund tracking](66-refund-tracking.md) for migration, recovery and rollout. Refund creation authorization, adjustment journals, disputes and transfers remain unfinished.
