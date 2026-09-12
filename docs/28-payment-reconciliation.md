# Payment reconciliation and settlement workers

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

## Implemented boundary

`PaymentReconciler` connects verified webhook hints and terminal ride events to current provider state. Migration `0007_brave_forge.sql` adds server-owned customer bindings and mapped payment attempts. Bindings are unique per rider/provider source and per provider customer/source. Mapped attempts are unique per ride and provider intent/source, carry the immutable quoted amount and a reconciliation revision, and reference the customer binding. These are internal records, never client-selected payment references.

The service resolves the stored intent/customer/ride/attempt/amount, fetches provider state outside database transactions, and validates the response. Inside a short transaction it locks the ride, verifies customer ownership and quoted fare, and conditionally advances the attempt revision. Every successful fetch advances that revision, even when the visible funding state does not change. Overlapping responses based on an older revision must retry and retrieve fresh state. Provider failures leave the local state unchanged.

Unknown references return a retryable error because webhook delivery can race the local commit of an intent mapping. The source identifies one configured platform account and test/live environment; mismatched jobs are rejected. Provider metadata alone cannot establish customer ownership.

## Funding decisions

| Current verified provider state and ride state | Local action |
| --- | --- |
| Full amount capturable, search deadline still valid | Authorize and enqueue matching |
| Partial hold, pending or required authentication | Keep matching blocked |
| Canceled/no-driver ride or expired search, uncaptured intent | Queue release |
| Completed ride with full capturable amount | Queue capture |
| Full quoted amount captured | Record paid; unexpected ride state also queues review |
| Partial captured amount | Require review; do not label fully paid |
| Provider cancellation | Record released; active/unexpected ride states also queue review |
| Interrupted, terminated or no-show ride | Require policy/support review rather than inventing charges |

Funding changes increment the ride version and atomically enqueue audit/outbox events. Losing authorization revokes pending offers. Driver acceptance already requires authorization; pickup progression now also requires it. Cancellation remains available through the existing ride policy, and an already in-progress trip can still be completed safely rather than getting stuck because payment needs review. Paid/released terminal payment states cannot regress from inconsistent provider results.

## Worker composition

`handlers()` supplies `payment.reconcile`, `payment.capture`, `payment.release`, and handlers for ride completion/cancellation/no-driver/interrupted/terminated/no-show events. Terminal ride events resolve the mapped attempt and reconcile immediately, so completion can queue capture without waiting for Stripe to emit another event.

Capture/release jobs verify the persisted attempt, ride ownership, fare and operation eligibility. The provider key is stable per attempt and operation. Capture only applies to a completed ride; release applies to cancellation/no-driver or an expired search awaiting release. Neither operation accepts a client-provided amount. After the provider call, the service retrieves and reconciles again. If that fetch fails after a successful charge, a retry reuses the same key; the Stripe adapter also recognizes already-captured/released state before mutation.

The production worker must compose these handlers with matching, notifications, payment-review escalation and other ride handlers. Do not silently discard `payment.review_required` or `payment.updated` events. The existing synthetic local entrypoint deliberately retains fixture settlement; the real provider/runtime composition is not enabled yet.

## Verification

Fourteen reconciliation tests and one pickup-authorization test use disposable PostgreSQL and synthetic provider responses. Coverage includes duplicate reconciliation, mismatched references/environments/ownership/fares, partial funding, required authentication, cancellation during fetch, expired search, concurrent stale responses, terminal-state regression, provider outages, offer revocation, stable capture retry, release eligibility and completion-to-capture-to-paid through the real outbox worker. No live account or charge is used.

## Remaining work

Customer provisioning, durable payment sessions, native PaymentSheet/CustomerSheet, saved methods, capture/allocation ledger, receipts, earnings and runtime/worker composition are implemented; see [native payments](31-native-rider-payments.md), [ledger](32-captured-funds-ledger.md), [earnings](37-driver-earnings.md) and [runtime](34-backend-runtime.md). Remaining: complete physical-device PaymentSheet/3DS and sandbox journey acceptance, refund/dispute authorization and journals, actual driver transfers/settlement, periodic reconciliation/review operations, retention and approved production policies. Staging evidence is not production activation.
