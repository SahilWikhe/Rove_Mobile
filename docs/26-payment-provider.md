# Payment provider boundary

The server now has a `PaymentProvider` interface and a Stripe adapter for authorization sessions, status retrieval, capture, cancellation/release and partial refunds. Stripe is implemented as a candidate integration; the merchant/Connect charge model and commercial responsibilities still require the final business decision. No live account was created or charged.

## Intended ride flow

Create a PaymentIntent with manual capture and server-owned fare/customer/ride/attempt identifiers. Return its client secret only through an authenticated owner-only endpoint to the native payment UI. That UI must handle authentication such as 3DS. Creating the intent alone does not authorize it. Before starting matching, the domain must retrieve and verify `requires_capture` with enough capturable funds. [Stripe authorization and capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)

After completion, capture the approved amount with the persisted provider operation key. For cancellation/no-driver outcomes, cancel an uncaptured intent under the approved fare policy. A captured payment requires an explicit refund decision; cancellation does not silently issue a refund. Refunds can remain pending and must not be recorded as settled solely because creation returned successfully.

The adapter pins Stripe SDK 22.6.1 and API version `2026-08-26.dahlia`, with ten-second request timeout and two network retries. Every mutating call requires an explicit stable idempotency key. The domain still needs to persist operation attempts before provider calls and reconcile uncertain outcomes. Stripe may prune idempotency records after at least 24 hours: an old unresolved creation must not be retried blindly after that retention window. [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests)

The adapter requires a server-configured `paymentMethodConfiguration` (`pmc_...`). Create a dedicated configuration for ride authorizations in each Stripe environment and enable only reviewed methods compatible with native PaymentSheet and manual capture. The adapter passes this configuration to Stripe and never hardcodes `payment_method_types`. Changing method availability is a Dashboard setting; it must still pass the sandbox authorization/capture/SCA test matrix before launch. This does not enable any methods or modify the connected account automatically. [Stripe payment method configurations](https://docs.stripe.com/payments/payment-method-configurations)

## Verification at the boundary

Each normalized intent is checked against the persisted intent, customer, ride, payment-attempt identifier, amount, currency, manual-capture mode and test/live mode. Capture, release and refund retrieve this reference before mutation. Already captured/canceled results are reconciled without issuing the same side effect again. Capturing beyond the original or available amount is rejected. Refunds cannot exceed the currently received amount; cumulative refund uniqueness and ledger limits also belong in the financial domain.

Only integer USD minor units are supported initially. Intent creation requires at least 50 cents; partial capture/refund inputs can be smaller positive amounts and remain subject to provider acceptance. Business pricing must be reviewed separately. No destination-transfer, application-fee, driver-payout or merchant-of-record model is silently selected by this adapter.

Provider errors are mapped to a safe unavailable response without exposing request/card details or client secrets. Normalized payment snapshots never contain a client secret. Creation returns that secret separately for the future owner-only payment session response; it must never enter audit logs, outbox payloads or client analytics.

## Webhook verification

The adapter verifies the signature against the exact raw body with the Stripe SDK, checks a five-minute timestamp window in both directions, enforces the configured test/live mode, rejects connected-account events on this platform-only adapter, and bounds body/signature size. It returns only event id/type/time/resource id. Do not parse/re-serialize the body before verification.

A verified event is a reconciliation hint. The webhook endpoint now durably deduplicates event ids and enqueues processing; see [durable webhook ingress](27-payment-webhook-ingress.md). The [reconciliation worker](28-payment-reconciliation.md) now retrieves current provider state before applying funding transitions, with revision checks against overlapping responses. Production composition is still required. Duplicate/out-of-order events must not double-capture, double-refund or regress a settled state. [Stripe webhooks](https://docs.stripe.com/webhooks)

## Executed tests and remaining integration

Nine adapter tests use mocked Stripe API methods; webhook tests use the real SDK's signing and verification helpers with synthetic secrets. They cover request parameters, key propagation, credential modes, invalid amounts, reference mismatch before mutation, capture/release retries, action-required/underfunded state, partial pending refunds, safe errors and signature/timestamp/tampering checks. No sandbox network charge has been verified yet.

Mapped customer/attempt records and capture/release/reconciliation handlers are implemented in docs/28-payment-reconciliation.md. Remaining work: customer/method provisioning, persisted creation operations, ledger/receipts/earnings, booking admission, owner-only PaymentSheet/session endpoints, production worker composition, refund authorization, periodic reconciliation, sandbox acceptance tests, native UI and Connect/payout setup. The existing local synthetic settlement handlers remain clearly labeled fixtures until the real domain is wired. Do not enable production bookings based on this adapter alone.
