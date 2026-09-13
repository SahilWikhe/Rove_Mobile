# Stripe sandbox payment acceptance

## Verified September 13, 2026

The existing Rove sandbox `acct_1UDH7bPUl4I4KcSJ` was verified through its test key before requests. Tests used the two dedicated synthetic staging rider/driver accounts previously created for acceptance, the provider-staging Neon branch and the actual `rove_staging_app` restricted runtime. No live Stripe mode, production database, Connect activation, Google lookup, matching or real money movement was involved. Stripe describes sandbox test instruments in [testing documentation](https://docs.stripe.com/testing/overview).

A private operator harness created a dedicated $2 ride/payment fixture. Fixture preparation used the staging migration role and persisted exact ride, attempt, customer-binding and operation identifiers before provider calls. It placed the synthetic ride directly in progress to keep matching and billed route lookup out of this test. This bypasses booking and native UI; it does not establish full consumer journey acceptance. The existing payment adapter, customer service, payment reconciler and refund reconciler executed through the restricted runtime role.

| Check | Observed result |
| --- | --- |
| Identity and mode | Expected sandbox account; test key and test PaymentIntent |
| Authorization | Stripe `pm_card_visa` test instrument produced full manual-capture authorization |
| Capture | $2 captured; ride completed and marked paid |
| Concurrent webhook | A local reconciliation encountered PAYMENT_RECONCILE_RETRY after a hosted webhook advanced the revision; readback already showed paid |
| Capture recovery | Resumed with the same saved intent/attempt and original keys; repeated capture handling retained exactly one capture journal and one allocation journal |
| Refund | Full $2 refund succeeded; repeated request with the same key returned the same refund ID |
| Accounting | Capture, allocation and refund-balance journals each appeared once and each summed to zero |
| Original processor balance | $2 gross, $0.36 fee, $1.64 net; original charge balance still pending, zero unrefunded cents |
| Hosted ingress | One receipt each for PaymentIntent creation, capturable update and success; all three corresponding payment reconciliation jobs completed |
| Hosted capture job | One completed capture job; no matching job for the fixture |

The private fixture and provider references are retained outside Git for inspection and safe retries; no client secret, credential, account email or raw provider payload is in this document. The synthetic trip is terminal and fully refunded. Financial history remains retained rather than deleted or rewritten. Original capture fees are separate from refund movements; a pending balance is not transfer-ready funding, and refund accounting does not by itself reverse a driver's earnings or transfer money out of a connected account.

## Gap found and corrected in source

Three payment.updated jobs became dead letters because runtime had no consumer for that topic. The new consumer uses the durable ride version/payment state and only emits a generic rider-owned ride-update hint for current paid, action-required or review-required states. Routine states, superseded versions, expired events and malformed historical payloads produce no OS alert. With push disabled, these known jobs stay pending without leases/attempts or a hot drain loop. Existing dead letters are retained and were not reset or replayed.

This correction has local PostgreSQL/runtime regression evidence. It does not enable push in staging or establish APNs/FCM display. See [push notification behavior](59-push-notifications.md#payment-update-delivery).

## Remaining acceptance and setup

- The staging key's Accounts v2 list request returned HTTP 403/forbidden. Connect onboarding and driver transfers remain disabled. Review the sandbox key's Accounts v2 access before provisioning a dedicated recipient; this check does not establish account creation, account-link creation or recipient capability readiness.
- Complete driver onboarding, transfer/reversal, available-balance and bank-payout acceptance separately. Do not reinterpret a refunded platform test charge as a payout test.
- Complete actual rider booking, native PaymentSheet/3DS, decline, cancellation/authorization release and lost-connectivity acceptance on both platforms. The recorded test confirmed via the API test instrument, not a native payment screen.
- Exercise staff refund authorization and financial policy decisions through their protected HTTP flows. This operator-approved synthetic refund tested the provider/reconciliation boundary, not staff MFA authorization.
- Run the same release candidate through current CI, protected release evidence and physical-device acceptance. The hosted callbacks observed here are evidence of that staging environment at the time, not an exact-current-main release approval.

Keep private operation IDs and original idempotency keys when investigating uncertain outcomes. Never create a replacement operation merely because a response was lost. Any future run needs its own deliberately isolated fixture and current sandbox/branch/account checks; this test is not added to automatic per-commit provider jobs.
