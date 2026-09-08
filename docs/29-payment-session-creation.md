# Durable rider payment sessions

## Endpoint and client boundary

`POST /v1/rides/:id/payment-session` accepts an empty JSON object from the owning authenticated rider. The server resolves the ride, immutable fare and provider customer binding; clients cannot supply customer ids, amounts or provider intent ids. Disabled accounts, other riders and driver accounts cannot obtain a session. Each authenticated subject has a shared PostgreSQL budget of ten session requests per minute. Unconfigured runtimes return 503.

The response contains only `rideId` and the Stripe client secret needed by the native payment UI. It is non-cacheable. `PaymentSession` is a shared strict response contract and the mobile API client validates it. Do not put this response in the operation journal, analytics, logs or persistent client storage. The native PaymentSheet screen is not yet wired.

## Creation journal and retries

Migration `0008_sudden_scalphunter.sql` permits an unmapped payment attempt with a null intent id. `PaymentSessions` locks the owned ride, resolves the existing server-owned customer binding and inserts the single attempt before calling Stripe. Its attempt id, source, customer binding, quoted fare and creation timestamp are durable. The provider creation key is derived from that attempt id and does not change across HTTP retries or process restarts.

No row lock is held during the provider call. Concurrent requests resolve the same attempt and key; Stripe's idempotency behavior is still required at the provider boundary. A provider failure leaves the attempt intact. A later request retries the same immutable input and key. Once an intent is mapped, sessions retrieve that intent instead of invoking creation again. A conflicting mapped intent is rejected rather than overwriting the reference.

An unresolved attempt older than 23 hours returns `PAYMENT_CREATION_REVIEW` without another creation call. This leaves a safety margin before Stripe can prune idempotency keys after at least 24 hours. Support must reconcile the original attempt with provider records; do not delete/recreate the attempt or blindly issue a new charge. Existing mapped intents can be retrieved without relying on the creation key's retention window.

## Cancellation and authorization

New attempts require a searching ride before its search deadline. Existing unresolved attempts can still recover their mapping after cancellation/deadline expiry so the payment worker can release any hold. After the provider response, the server commits the mapping and one reconciliation job atomically, then checks whether the rider may receive the secret. If cancellation, expiry or account disablement raced the call, it retains the cleanup reference/job but withholds the secret and returns an error.

Session creation does not authorize matching. The provider intent uses manual capture; native confirmation/SCA and subsequent authoritative reconciliation establish whether the full fare is held. The existing webhook and ride-event workers handle later authorization, cancellation and completion. Client success messages alone never set funding state.

## Verification and remaining integration

Eight HTTP/PostgreSQL tests cover owner/role checks, injected amount/customer fields, persistence before the external call, secret exclusion from storage, uncertain-outcome retry, retrieval after mapping, eight concurrent requests, cancellation during creation, the 23-hour cutoff, missing payment profiles, expired requests and the shared request budget. A Stripe adapter test validates existing-session ownership before exposing a secret. A mobile API-client test checks the authenticated request and response validation. All provider interactions in these tests are synthetic.

Durable customer provisioning is implemented and can compose with this service; see [customer provisioning](30-payment-customer-provisioning.md). Still required: saved-method setup, native PaymentSheet/SCA and callback handling, account-specific publishable-key configuration, sandbox network verification, creation-review tooling, ledger/receipts/refunds/earnings/payouts and production composition. A plugin connection does not supply app runtime credentials automatically. Existing local synthetic settlement remains explicit; this endpoint must not be presented as a completed production payment integration.
