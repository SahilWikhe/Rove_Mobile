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
- Real, isolated local PostgreSQL testing; no production database used.
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
- Disposable local integration server with clearly labeled synthetic maps, identities and payments.

Executed checks: contracts 3 tests; database 4 tests; server 25 tests; API 8 tests; mobile client 3 tests (43 total). All eight workspace typechecks pass. Both current Expo apps export iOS, Android and web bundles. Local browser verification exercised rider search/quote/request, driver online/offer/acceptance, arrival/start/completion, rider payment-state update, cancellation and expired-offer handling. Exact details disappeared from the driver view after completion. This used synthetic providers and real local PostgreSQL; it is not native-device or real-provider verification.

## Remaining implementation

- Deployable API composition/environment parsing, production provider wiring, rate limiting and expanded authorization coverage.
- Live route/place provider wiring and verification, payment authorization/capture/refund, tokenized payment UI and webhook reconciliation.
- Production durable wakeup/queue integration, reconciliation and operational dead-letter replay.
- Driver onboarding, location/availability, profile/account, ride history, support and earnings.
- Driver earnings/account/onboarding, remaining rider account/help/payment screens, native maps and background location tracking.
- Scheduling module behind default-off flags and provider integration.
- Staff backend permissions and audited use cases; dashboard UI remains a separate repository.
- CI, security checks, provider integration tests, API tests and native end-to-end verification.
- Environment samples, operational setup and paid-provider/business-decision handoff.

## Known intermediate gaps

The local synthetic API entrypoint runs; the production entrypoint and real providers remain to be composed. The apps are not end-to-end functional with real accounts yet. Rider booking needs payment-method review, persistent command recovery across app restarts, no-driver retry and verified cancel-fee copy. Current rider polling must become foreground-aware. Driver location currently runs from the Drive screen and must move to an app-wide foreground/background service so tracking survives navigation. Driver profile creation does not yet lead to the full document/payout onboarding flow. OAuth account selection and real native callbacks still need provider/device verification. Shared visual tokens approximate the approved design until exact Figma variables can be rechecked. The driver “Trips & earnings” entry currently opens trip history; earnings must be added before that wording ships.

## Delivery instructions

The user authorized building and verifying the complete mobile product, deferring paid account setup and final business decisions to the handoff, and pushing the result to `main`. The current implementation is being committed as an intermediate checkpoint at the user’s explicit request. This push does not represent completion of the full product. No production deployment is included.

The local synthetic rates are fixtures, not approved customer pricing. Do not enable real bookings until provider setup, policies and launch checks are completed.
