# Implementation status

Updated: September 8, 2026. This is an implementation ledger, not a production-readiness claim.

## Verified foundation

- pnpm workspace with shared contracts, server domain, database and API package boundaries.
- Strict input schemas for quotes, money, coordinates, driver offers and scheduling capabilities.
- Default-off scheduling capability evaluation and legal trip-state policy.
- Drizzle schema and generated versioned PostgreSQL migration.
- Database constraints for active rider/driver assignments and pending offers.
- Transactional booking, driver acceptance and consumer trip transitions.
- Actor-scoped idempotency results committed with ride mutations, audit records and outbox events.
- Real, isolated local PostgreSQL testing; no production database used. Database shutdown now waits for all connection end events, with a regression test for concurrent/idempotent close.
- Hono API with signed OIDC token validation, database-owned roles, disabled-account checks, JSON validation, bounded bodies and non-cacheable responses.
- Profile registration cannot create staff or approve drivers. Quote creation resolves provider places before pricing.
- Role-scoped ride history/details; drivers lose exact endpoints and rider identity after the trip ends.
- Shared typed mobile API client with response validation, bounded requests and explicit mutation keys.
- Expo rider/driver projects, shared Manrope/black/gold UI, PKCE sign-in and native secure token storage.
- Rider route search, quote review, request, status and history screens; initial driver signup/profile screen.
- Driver availability and sequence-checked location heartbeat, expiring offers, accept/decline, explicit trip milestones and trip history.
- Automatic bounded candidate ranking by route ETA, one pending offer per ride/driver, expiry advancement, deadline exhaustion and cancellation-race checks.
- Persistent outbox leases, fenced completion, retry backoff and dead letters.
- Google Places/Routes adapter with bounded requests, provider-response validation, coarse offer areas and mocked transport tests; not yet wired to a live provider.
- Location-only expiring/rotating background credentials, hash-only storage, offline revocation and monotonic upload validation. Native Expo task/permissions, credential storage, reconnect and cleanup are wired; physical-device verification remains outstanding.
- Disposable local integration server with clearly labeled synthetic maps, identities and payments.

Executed checks: contracts 3 tests; database 5 tests; server 96 tests; API 58 tests; mobile client/tracking/polling/recovery/payment/session 49 tests; driver native lifecycle/sign-out 14 tests (225 total). All eight workspace typechecks pass. Both current Expo apps export iOS, Android and web bundles. Local browser verification exercised rider search/quote/request, driver online/offer/acceptance, arrival/start/completion, rider payment-state update, cancellation and expired-offer handling. Exact details disappeared from the driver view after completion. This used synthetic providers and real local PostgreSQL; it is not native-device or real-provider verification.

CI now has committed-source configuration for full-suite quality, tests, mobile exports, dependency/secret scanning, CodeQL and a fail-closed aggregate gate. Seven tooling regression tests supplement the application tests. See [CI verification](21-ci-verification.md) for dependencies, scope and remaining native verification. The initial pipeline passed all six jobs on [GitHub run 34187153892](https://github.com/SahilWikhe/Rove_Mobile/actions/runs/34187153892).

Bookings, rider cancellation and driver trip transitions now preserve operation keys and payloads in account-scoped storage, with explicit recovery prompts. See [operation recovery](25-operation-recovery.md) for supported operations and remaining device/support work.

## Remaining implementation

- Deployable API composition, production provider wiring, perimeter rate limits and expanded authorization coverage. Authenticated API and background-location rate limits now share atomic PostgreSQL counters with concurrency tests; grant rotation cannot reset upload budgets and the native task respects throttle pauses; see docs/23-request-rate-limits.md. Explicit deployment configuration parsing and secret-safe validation are implemented; see docs/22-api-configuration.md.
- Live route/place provider wiring and verification, payment domain/ledger/worker wiring, tokenized payment UI and webhook reconciliation. A typed Stripe candidate adapter and raw webhook verifier are implemented with nine transport/signature tests; see docs/26-payment-provider.md. Durable ingress adds six HTTP/PostgreSQL tests for signed deliveries, deduplication, rollback, event ordering and size limits; see docs/27-payment-webhook-ingress.md. Provider-backed reconciliation and capture/release worker handlers now have PostgreSQL race tests and a completion-to-settlement outbox test; see docs/28-payment-reconciliation.md. Durable intent creation, rider-only sessions and the mobile API method are now implemented with retry/cancellation tests; see docs/29-payment-session-creation.md. Durable customer provisioning now composes with rider payment sessions; see docs/30-payment-customer-provisioning.md. Native PaymentSheet, callback handling and a rider confirmation screen are now wired with controller tests and platform exports; see docs/31-native-rider-payments.md. Captured-fund and earnings-allocation journals now commit atomically with reconciliation and enforce balance/immutability in PostgreSQL; see docs/32-captured-funds-ledger.md. Rider receipts and runtime composition are implemented; actual sandbox/native-device verification, deployed worker scheduling and the remaining financial operations are outstanding.
- Production durable wakeup/queue integration, reconciliation and operational dead-letter replay.
- Driver onboarding, location/availability, profile/account, ride history, support and earnings.
- Driver earnings/account/onboarding, remaining rider account/help/payment screens, native maps and physical-device background location verification.
- Scheduling module behind default-off flags and provider integration.
- Staff backend permissions and audited use cases; dashboard UI remains a separate repository.
- Extend provider integration/API tests and add native end-to-end verification.
- Environment samples, operational setup and paid-provider/business-decision handoff.

Rider capture receipts now use owned ledger records and show actual captured amounts independently from quoted fares; see [rider receipts](33-rider-receipts.md).

## Known intermediate gaps

The local synthetic API entrypoint runs. A separate Hono entrypoint now composes real adapters and passes a packaged Node smoke check; see docs/34-backend-runtime.md. Unpaid-search expiration now has durable deadline jobs and a bounded recovery sweep; see docs/35-search-expiration.md. Private Vercel queue wakeups and an authenticated recovery cron are now configured in code; see docs/36-worker-hosting.md. Cloud deployment/delivery verification and notification/review consumers remain outstanding. The apps are not end-to-end functional with real accounts yet. Rider booking needs payment-method review, native verification of the new booking/cancellation/transition journal, no-driver retry and verified cancel-fee copy. Rider trip, driver trip and driver availability polling now pause on background/blur, cancel stale requests and resume immediately; see docs/24-live-screen-updates.md. Driver foreground tracking is now owned by the app layout and survives route navigation, with cancellation on backgrounding/sign-out and fresh server sequence recovery. Native background tracking now uses a separate location-only grant and module-scope task, with native permission configuration and lifecycle tests. Physical-device background delivery and complete operational recovery remain unverified; see docs/20-driver-location.md. Driver profile creation does not yet lead to the full document/payout onboarding flow. OAuth account selection and real native callbacks still need provider/device verification. Figma design context and screenshots for rider Home (2:12) and driver Online (1:62) were retrieved successfully on September 7. The rider Home and shared colours now have initial Figma alignment and iOS visual verification; remaining frames and Android visual verification are outstanding. See [rider home design](40-rider-home-design.md). Driver Trips and Earnings now have separate navigation. Recorded driver allocations have an owned API and earnings screen; older/newer history browsing is implemented; date filters and payout workflows remain outstanding; see docs/37-driver-earnings.md.

Both apps now support owned profile-name editing with conflict detection and shared mobile UI; see [profile editing](38-profile-editing.md).

The rider native Debug build now compiled successfully with Xcode for the local iPhone 17 Pro simulator (iOS 26.5). The installed `co.roveride.rider` app launched and its synthetic welcome screen was visually inspected. CocoaPods 1.17.0 was installed locally for this build. This proves native compilation/startup only: native sign-in, trip execution, PaymentSheet, physical-device background delivery and Android native builds remain unverified. The simulator and local preview servers were left running for the founder to explore.

Driver Account now supports ordered offline confirmation, tracking cleanup and sign-out with failure recovery; see [driver sign-out](39-driver-sign-out.md). The driver Debug app also compiled and launched in the iOS simulator; its synthetic home screen was inspected. Physical-device and complete native ride/auth/payment verification remain outstanding.

Session generation guards and serialized credential storage now prevent stale refresh/login/hydration results from restoring signed-out credentials; see [session lifecycle](41-session-lifecycle.md). Managed-provider and full native auth verification remain outstanding.

Rider and driver history now support older/newer page navigation with foreground refresh and account-scoped state; see [ride history browsing](42-ride-history.md).

Booking lookups now cancel obsolete search/quote responses, clear edited route selections and isolate account navigation; see [booking request lifecycle](43-booking-request-lifecycle.md).

Rider booking now offers Standard and Accessible service selection with new-quote review and eligibility regression coverage; see [ride service selection](44-ride-service-selection.md).

The quote confirmation now follows the supplied Figma route-card, typography and gold-action design with consumer quote data; see [confirmation design](45-booking-confirmation-design.md).

Temporary auth refresh failures now preserve saved sessions while preventing expired-token API requests; see [auth refresh recovery](46-auth-refresh-recovery.md).

An owned Home/Work saved-place API, migration, mobile client, booking controls and Home shortcuts are implemented; the shortcut flow passes browser and iOS simulator checks. Full native management, Android interaction and hosted-environment migration remain pending. See [saved places](47-saved-places.md).

A driver-owned vehicle-submission API and client now separate pending vehicle details from effective approval; a driver vehicle form and staff review API are implemented, while document upload and full eligibility activation remain pending. See [vehicle submissions](48-driver-vehicle-submission.md).

A permission-scoped staff vehicle review API now records immutable decisions without enabling driver eligibility; see [staff vehicle review](49-staff-vehicle-review.md). Staff review requires verified MFA and explicit permission. Provider MFA setup verification, document upload and the separate dashboard remain pending.

Consumer support intake, history, staff queue/response APIs and safe vehicle correction guidance are implemented; see [support requests](50-support-requests.md). This is not a staffed or emergency support operation.

Required browser CI now covers booking/cancellation, the two-app synthetic trip, receipt/earnings history, lost-response recovery, support and real search-deadline recovery; see [browser checks](51-browser-ci.md). Local payments run through shared reconciliation/ledger services with a synthetic provider; real Stripe settlement remains unverified.

Completed driver trips show ledger-backed earnings with explicit payout limitations; see [trip earnings](52-driver-trip-earnings.md). An unmatched rider search can lead to a fresh route/quote review without automatic booking; see [search recovery](53-no-driver-recovery.md).

Shared native endpoint maps have been added to authorized ride/trip details; see [native maps](54-native-trip-maps.md). Production SDK key setup and real Google rendering remain outstanding. Rider-visible driver location now has assignment authorization, sample-time freshness and foreground polling; see [live driver location](55-live-driver-location.md). Physical-device GPS delivery is still unverified.

Driver payout onboarding now has a durable provider binding, Accounts v2 adapter, authenticated endpoints and a driver setup screen; see [payout onboarding](56-driver-payout-onboarding.md). It defaults off, does not enable driving or transfer money, and still requires real sandbox/native verification. Dedicated account-event reconciliation now updates expiring payout readiness and revokes stale eligibility without abandoning active rides; see [payout account events](57-payout-account-reconciliation.md).

Driver directions now recheck trip authorization and endpoint freshness before external Maps handoff; see [driver navigation](58-driver-navigation.md). Real device navigation remains unverified.

An Expo push transport adapter now validates generic hints and handles tickets/receipts; see [push notifications](59-push-notifications.md). Installation registration, durable delivery consumers and native permission/delivery flows remain unimplemented.

## Delivery instructions

The user authorized building and verifying the complete mobile product, deferring paid account setup and final business decisions to the handoff, and pushing the result to `main`. The current implementation is being committed as an intermediate checkpoint at the user’s explicit request. This push does not represent completion of the full product. No production deployment is included.

The local synthetic rates are fixtures, not approved customer pricing. Do not enable real bookings until provider setup, policies and launch checks are completed.
