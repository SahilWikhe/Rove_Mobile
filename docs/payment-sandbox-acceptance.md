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
| Hosted rider receipt | After enabling read-only staging refund tracking, authenticated rider sees original $2 capture and one succeeded $2 refund with verification timestamp |
| Receipt authorization | Driver receives 404; anonymous request receives 401 |

The private fixture and provider references are retained outside Git for inspection and safe retries; no client secret, credential, account email or raw provider payload is in this document. The synthetic trip is terminal and fully refunded. Financial history remains retained rather than deleted or rewritten. Original capture fees are separate from refund movements; a pending balance is not transfer-ready funding, and refund accounting does not by itself reverse a driver's earnings or transfer money out of a connected account.

## Gap found and corrected in source

Three payment.updated jobs became dead letters because runtime had no consumer for that topic. The new consumer uses the durable ride version/payment state and only emits a generic rider-owned ride-update hint for current paid, action-required or review-required states. Routine states, superseded versions, expired events and malformed historical payloads produce no OS alert. With push disabled, these known jobs stay pending without leases/attempts or a hot drain loop. Existing dead letters are retained and were not reset or replayed.

This correction has local PostgreSQL/runtime regression evidence. It does not enable push in staging or establish APNs/FCM display. See [push notification behavior](59-push-notifications.md#payment-update-delivery).

## Authenticated cancellation and hold release

A separate persisted synthetic $2 fixture was placed directly in matched state, then authorized using the existing test instrument and restricted runtime reconciliation. This deliberately bypasses booking, driver matching and Maps lookup. The dedicated rider called the hosted transitions endpoint to cancel, then repeated the same request body and idempotency key. Both returned 200 and the same cancelled ride response. The hosted ride.cancelled and payment.release jobs each completed once with no dead letters.

Stripe readback showed canceled with zero received and zero capturable cents; the local ride recorded released. Repeating the release handler twice through the restricted runtime retained that result. No ledger journal or matching job existed for this fixture. The terminal cancelled fixture and original provider identifiers remain private for safe inspection; no production or live-mode operation occurred.

The first reconciliation encountered the expected concurrent-webhook revision conflict and resumed the same persisted attempt. An evidence query initially referenced a nonexistent outbox status column; it was corrected to completed_at/dead_letter_at. A later HTTP retry returned 401 after the test token expired; dedicated Universal Login/PKCE was refreshed and the complete same-fixture check then exited successfully. None of these retries created a replacement payment. Native cancellation controls, process-death recovery and the complete booking journey still need separate acceptance.

## Decline and authentication-required guards

Two further isolated matched-ride fixtures used Stripe's documented pm_card_visa_chargeDeclined and pm_card_authenticationRequired test methods. The first returned card_declined/generic_decline and requires_payment_method; the second returned requires_action. Both had zero capturable and received cents. These deliberately preassigned fixtures verify protection when an assigned ride lacks authorization, not initial booking/matching or the native 3DS challenge. See [Stripe test instruments](https://docs.stripe.com/testing#regulatory-cards).

Restricted reconciliation retained matched state with review_required funding. Authenticated driver en_route transitions returned 409/PAYMENT_REQUIRED, and direct capture handlers rejected PAYMENT_OPERATION_NOT_ALLOWED. Authenticated rider cancellation and same-key retries succeeded. Hosted cancellation/release jobs each completed once, final provider status was canceled, local funding was released, repeated release handling was safe and no ledger journals or matching jobs existed. Both private fixtures are terminal; no collected funds or real production changes occurred. Authentication-required reconciliation initially encountered a concurrent-webhook revision conflict and resumed the same intent/keys successfully.

The broader outbox inspection exposed one dead-lettered payment.review_required event for each fixture. Runtime has no handler for that escalation topic. This remains an explicit production blocker: implement durable staff review intake/visibility with authorization, deduplication and recovery rather than discard or pretend to deliver the event. Existing dead letters were preserved. The three payment.updated events per fixture correctly remained unclaimed with push disabled. Payment safety guards passed, but staff escalation and native decline/3DS presentation are not proven.

## Remaining acceptance and setup

- The staging key's Accounts v2 list request returned HTTP 403/forbidden. Connect onboarding and driver transfers remain disabled. Review the sandbox key's Accounts v2 access before provisioning a dedicated recipient; this check does not establish account creation, account-link creation or recipient capability readiness.
- Complete driver onboarding, transfer/reversal, available-balance and bank-payout acceptance separately. Do not reinterpret a refunded platform test charge as a payout test.
- Complete actual rider booking, native PaymentSheet/3DS, decline, cancellation/authorization release and lost-connectivity acceptance on both platforms. The recorded test confirmed via the API test instrument, not a native payment screen.
- Exercise staff refund authorization and financial policy decisions through their protected HTTP flows. This operator-approved synthetic refund tested the provider/reconciliation boundary, not staff MFA authorization.
- Run the same release candidate through current CI, protected release evidence and physical-device acceptance. The hosted callbacks observed here are evidence of that staging environment at the time, not an exact-current-main release approval.

Keep private operation IDs and original idempotency keys when investigating uncertain outcomes. Never create a replacement operation merely because a response was lost. Any future run needs its own deliberately isolated fixture and current sandbox/branch/account checks; this test is not added to automatic per-commit provider jobs.

## Native iOS authorization and release

On September 13, the owned iOS simulator authenticated the dedicated rider and submitted the [documented Stripe sandbox Visa](https://docs.stripe.com/testing) in native PaymentSheet. The form accepted a future expiry and synthetic billing values. Maestro observed Payment confirmed; Stripe independently reported $2 capturable, zero received, and test mode. The fixture used a validated synthetic quote and did not exercise quote lookup or booking creation. Precheck found zero online approved drivers.

The rider cancellation endpoint first rejected an expired test token with 401. After Universal Login and PKCE refresh, retrying the same persisted cancellation key returned 200. Hosted processing released the entire hold; the final ride was cancelled/released, Stripe had zero received/capturable funds, and the attempt had no ledger journals. Maestro observed This ride request has ended in the payment screen. Cancellation was initiated through authenticated HTTP, not the native ride button. The private fixture remains terminal. Native 3DS, full ride completion/capture, Android and physical devices are still separate gates.
