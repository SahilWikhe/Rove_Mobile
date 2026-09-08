# Implementation status

Updated: September 7, 2026. This is an implementation ledger, not a production-readiness claim.

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

Executed checks: contracts 3 tests; database 5 tests; server 60 tests; API 23 tests; mobile client/tracking/polling/recovery 26 tests; driver native lifecycle 7 tests (124 total). All eight workspace typechecks pass. Both current Expo apps export iOS, Android and web bundles. Local browser verification exercised rider search/quote/request, driver online/offer/acceptance, arrival/start/completion, rider payment-state update, cancellation and expired-offer handling. Exact details disappeared from the driver view after completion. This used synthetic providers and real local PostgreSQL; it is not native-device or real-provider verification.

CI now has committed-source configuration for full-suite quality, tests, mobile exports, dependency/secret scanning, CodeQL and a fail-closed aggregate gate. Seven tooling regression tests supplement the application tests. See [CI verification](21-ci-verification.md) for dependencies, scope and remaining native verification. The initial pipeline passed all six jobs on [GitHub run 34187153892](https://github.com/SahilWikhe/Rove_Mobile/actions/runs/34187153892).

Bookings, rider cancellation and driver trip transitions now preserve operation keys and payloads in account-scoped storage, with explicit recovery prompts. See [operation recovery](25-operation-recovery.md) for supported operations and remaining device/support work.

## Remaining implementation

- Deployable API composition, production provider wiring, perimeter/background-upload rate limits and expanded authorization coverage. Authenticated API rate limits now share atomic PostgreSQL counters with concurrency tests; see docs/23-request-rate-limits.md. Explicit deployment configuration parsing and secret-safe validation are implemented; see docs/22-api-configuration.md.
- Live route/place provider wiring and verification, payment domain/ledger/worker wiring, tokenized payment UI and webhook reconciliation. A typed Stripe candidate adapter and raw webhook verifier are implemented with nine transport/signature tests; see docs/26-payment-provider.md. Durable ingress adds six HTTP/PostgreSQL tests for signed deliveries, deduplication, rollback, event ordering and size limits; see docs/27-payment-webhook-ingress.md. Provider-backed reconciliation and capture/release worker handlers now have PostgreSQL race tests and a completion-to-settlement outbox test; see docs/28-payment-reconciliation.md. Runtime composition, payment creation and ledger remain outstanding.
- Production durable wakeup/queue integration, reconciliation and operational dead-letter replay.
- Driver onboarding, location/availability, profile/account, ride history, support and earnings.
- Driver earnings/account/onboarding, remaining rider account/help/payment screens, native maps and physical-device background location verification.
- Scheduling module behind default-off flags and provider integration.
- Staff backend permissions and audited use cases; dashboard UI remains a separate repository.
- Extend provider integration/API tests and add native end-to-end verification.
- Environment samples, operational setup and paid-provider/business-decision handoff.

## Known intermediate gaps

The local synthetic API entrypoint runs; the production entrypoint and real providers remain to be composed. The apps are not end-to-end functional with real accounts yet. Rider booking needs payment-method review, native verification of the new booking/cancellation/transition journal, no-driver retry and verified cancel-fee copy. Rider trip, driver trip and driver availability polling now pause on background/blur, cancel stale requests and resume immediately; see docs/24-live-screen-updates.md. Driver foreground tracking is now owned by the app layout and survives route navigation, with cancellation on backgrounding/sign-out and fresh server sequence recovery. Native background tracking now uses a separate location-only grant and module-scope task, with native permission configuration and lifecycle tests. Physical-device background delivery and complete operational recovery remain unverified; see docs/20-driver-location.md. Driver profile creation does not yet lead to the full document/payout onboarding flow. OAuth account selection and real native callbacks still need provider/device verification. Figma design context and screenshots for rider Home (2:12) and driver Online (1:62) were retrieved successfully on September 7. Shared visual tokens/layouts still need alignment and native visual verification. The driver “Trips & earnings” entry currently opens trip history; earnings must be added before that wording ships.

## Delivery instructions

The user authorized building and verifying the complete mobile product, deferring paid account setup and final business decisions to the handoff, and pushing the result to `main`. The current implementation is being committed as an intermediate checkpoint at the user’s explicit request. This push does not represent completion of the full product. No production deployment is included.

The local synthetic rates are fixtures, not approved customer pricing. Do not enable real bookings until provider setup, policies and launch checks are completed.
