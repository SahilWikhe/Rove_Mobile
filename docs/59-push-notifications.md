# Push notifications

## Current checkpoint

The Expo transport, registration API/native opt-in, authenticated tap routing, recipient resolver and durable delivery/receipt worker are implemented. Hosted delivery is explicitly disabled by default. No real Expo credentials, device tokens or external sends were used for this checkpoint. Configure and verify sandbox delivery before enabling it. Unrelated review/payment-notification event types still require their own consumers; the worker handles only the ride/offer topics listed below.

## Payload and transport

Hints contain only a UUID event reference, a UUID resource reference and a fixed kind (`ride_update` or `offer_available`). Lock-screen text is generic. The strict schema rejects arbitrary extra fields. There is no address, rider name, fare, medical data, URL, auth token or free-text message in the payload. A resource reference does not authorize a resource read.

One recipient per request avoids combining app projects. URLs are fixed to Expo's send/receipt endpoints; redirects are rejected. The constructor requires a server access token. Requests have a ten-second timeout, response bodies are limited to 64 KiB, and failures expose only fixed internal error codes/messages. Raw provider bodies and destination tokens must never be logged.

Hints expire within five minutes; an expired hint makes no network request. Offer orchestration must use the actual offer deadline, which may be much shorter. The adapter does not invent offer validity. Collapse/tag identifiers use the opaque resource reference to reduce repeated visible updates; they do not provide exactly-once delivery.

## Result semantics

| Result | Required orchestration behavior |
| --- | --- |
| Ticket accepted | Persist receipt ID and schedule receipt lookup; do not mark device delivery. |
| Expired | Record expiration without sending. |
| Invalid token | Disable only the exact registration generation used for that delivery. |
| Retryable throttle | Retry with bounded backoff before the hint expires. |
| Configuration error | Surface operational failure; fix credentials before retry. |
| Rejected or unknown individual error | Retain a reviewable failure; do not silently declare success. |
| Unconfirmed send/network failure | Preserve uncertainty; a retry may produce a duplicate. |
| Receipt pending | Keep checking within a bounded receipt window; never translate absence to success. |
| Accepted by gateway | Record provider acceptance, not proof that the phone displayed it. |

The adapter performs no hidden retry. Durable state must own retries, correlation, expiry and deduplication across worker crashes. A timed-out request may already have been accepted externally. HTTP service errors are likewise not proof that nothing was sent.

## Provider setup for handoff

Use separate EAS project configuration for rider and driver, and isolate production from test registrations. Configure APNs and FCM credentials for their respective native apps, enable Expo enhanced push security and keep its access credential on the backend. Device installation tokens belong in access-controlled backend storage, never public configuration or analytics.

Expo recommends checking receipts after about fifteen minutes; receipts are removed after twenty-four hours. Invalid-device responses mean the token should stop receiving sends until registered again. Receipt success means acceptance by APNs/FCM, not guaranteed phone delivery. These semantics and setup come from the [Expo send and receipt documentation](https://docs.expo.dev/push-notifications/sending-notifications/).

## Installation registrations

Migration `0022_push_installations.sql`, the domain service, authenticated API routes and shared mobile-client methods are implemented. No production migration has run. `EXPO_RIDER_PROJECT_ID` and `EXPO_DRIVER_PROJECT_ID` must both be valid, distinct EAS project UUIDs to enable registration in the hosted runtime. With both omitted the endpoints return `PUSH_UNAVAILABLE`. This enables registration only, not delivery. Project selection derives from the authenticated role; a request cannot pick a project, environment or owner. Staging and production still require isolated databases and native build configuration.

| Route | Body and behavior |
| --- | --- |
| POST `/v1/push-installations/status` | Installation UUID and device secret; returns current revision and whether enabled for this account. |
| PUT `/v1/push-installations` | Proof, platform, Expo token, expected revision and mutation UUID; creates, refreshes or transfers the binding. |
| DELETE `/v1/push-installations` | Proof, expected revision and mutation UUID; revokes only the current account's binding. |

The device must generate a random 32-byte secret and keep it in secure storage alongside its installation ID and pending mutation. The server stores its SHA-256 hash, never the original secret. Proof is sent in an authenticated body rather than a URL. Responses contain only installation ID, revision and enabled state, never tokens, proof or another account's identity. A new signed-in account possessing the installation secret can read its revision and explicitly transfer the binding; knowing a push token alone cannot take over an existing installation.

Owner and installation locks serialize initial writes and transfers. Revisions fence stale updates. A retry of the last identical mutation returns its existing result; changed content under that mutation ID or a stale revision fails. Status lookup allows recovery after an uncertain response, but callers must not automatically reapply an obsolete account's intent after reading a newer revision. The native session generation must cancel old account work.

Enabled tokens are unique within a project, checked under a token-specific lock before a write and protected by a unique database index. One account may have at most ten active registrations. Receipt invalidation requires the internal registration ID and exact revision captured before sending. It increments the revision and clears retry metadata, so an old receipt or delayed registration cannot undo a refresh or account transfer. Revoked rows remain as fencing records; automatic row deletion could permit stale requests to recreate them and is not implemented.

An installation that loses its secret cannot silently reclaim a binding. Account device-management/recovery and a reviewed token-retention policy still need implementation. The API is not proof of physical device possession or an attestation mechanism: authenticated clients must securely obtain and protect their own native Expo tokens. Configure database logging/access so bound tokens and proof bodies are not captured in logs.

Verification: six disposable-Postgres registration tests cover retries, concurrency, transfers, invalid proof, stale logout/receipts, duplicate tokens, limits and disabled/forged roles. API tests cover authentication, strict fields, no-store output and proof checks. Runtime tests cover omitted, incomplete and conflicting project settings; mobile-client tests cover exact bodies and caller-owned retry identifiers. All 350 workspace tests, workspace type/lint/import checks and packaged API verification pass. The subsequent native integration is described below; real token/provider verification remains outstanding.

## Native registration and account controls

Both account screens now expose shared Trip notifications controls. Web, synthetic mode and native builds without a valid `EXPO_PUBLIC_EAS_PROJECT_ID` show an unavailable explanation and do not request permission or register a token. The native UUID must match the backend project for that app. The SDK is pinned to the [Expo SDK 57 recommendation](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/) (`expo-notifications ~57.0.17`) and its config plugin is included in both apps; rebuild native binaries after this change.

Explicit Enable requests permission if it can be requested, accepts iOS provisional authorization, obtains the Expo token for the configured project and registers it through the owned API. Android creates a trip-updates channel before the permission request. Returning to the foreground or receiving a token-change callback refreshes an existing opt-in without asking for permission again. Revoked OS permission triggers registration cleanup. A failed check is not displayed as confirmed registration. The UI says registered, not delivered.

A shared journal scoped to API URL and EAS project stores installation identity, opt-in intent, revision and any pending mutation in device-only secure storage. Identity uses a cryptographically random UUID and 32-byte secret; web receives no equivalent persistent push store. Every mutation is persisted before networking. An interrupted registration is replayed with its exact retry ID before revocation, so a delayed first registration cannot race a normal sign-out. Lost acknowledgment or failed local persistence keeps the pending request recoverable. Corrupt storage is not silently replaced. Device-management recovery remains necessary if secure identity is lost.

Session generations reject late work after an account change. A previous account's pending intent is never replayed with a new account's credentials. A current explicit operation can reconcile a stale revision through a proof-based status read; it does not blindly resubmit the obsolete mutation. The journal serializes account/installation work. Normal sign-out confirms notification revocation before clearing credentials; if this fails, sign-out reports a retryable error. Unexpected auth expiry cannot guarantee remote revocation without valid credentials: future delivery authorization, bounded registration lifetime and account-device management must account for that case. Existing already-delivered OS notifications cannot be recalled by database revocation.

Verification adds nine controller tests for storage ordering/failure, exact retry recovery, delayed account work, stale revisions and response identity. All 359 workspace tests and eight tooling checks pass, as do type/lint/boundary checks and both apps' iOS/Android/web exports. Browser tests verify the unavailable account state in both apps while preserving support navigation. Real OS permission prompts, Expo token refresh, live authenticated registration/revocation and physical-device delivery have not been exercised. Both iOS Debug binaries were rebuilt and launched on the iPhone 17 Pro iOS 26.5 simulator. The reusable `native-smoke/notification-settings.yaml` passed for both synthetic account screens. Screenshot review caught a duplicate React key, which was corrected and rechecked. Final [rider](screenshots/rider-notification-settings.png) and [driver](screenshots/driver-notification-settings.png) screenshots were visually inspected without that warning. The dependency audit found no known vulnerabilities. Android interaction and real delivery remain unverified.

## Notification taps

Both native app roots now attach a response listener after session restoration, consume the saved cold-start response and remove the listener on session changes/unmount. Signed-out taps are consumed without retaining them for a later login. Only the default OS tap action is supported; arbitrary notification URLs and action commands are ignored. No permission prompt is introduced by listening.

`PushHint` is a shared strict contract containing only an event UUID, resource UUID and known kind. The controller reads the current authorized ride or current driver offer feed before navigating to a fixed role-specific screen. Missing, unauthorized, mismatched or expired resources cannot open from the hint. A generic unavailable message directs the user to current trips/offers without reflecting payload data. Booking, acceptance and trip transitions still require explicit normal screen actions and server checks.

Session-generation checks prevent late responses navigating after credentials change, even if a transport ignores cancellation. New valid taps supersede older pending reads; duplicate events are ignored within a bounded session cache. Resource screens perform their normal fresh reads after navigation. This is not a replacement for API authorization or a guarantee of notification delivery.

Six controller regression tests cover both roles, duplicate and malicious payloads, missing/expired offers, denied or mismatched resources, signed-out behavior, account changes, superseding reads and unmount cancellation. All 365 workspace tests, typechecks, lint and import-boundary checks pass. Both apps export iOS, Android and web bundles, and their notification-settings iOS simulator smoke flows pass after listener integration. Native OS notification delivery/tapping and Android interaction still require device verification; controller tests alone do not establish that coverage.

## Delivery recipient authorization

`PushAudience` provides the database-backed recipient resolver for the pending delivery worker. It reloads the original outbox event rather than accepting a recipient or message from job input. Known ride events select the current rider and assigned driver; offer events must match the persisted offer ID, ride and driver. Staff accounts and unrelated riders are excluded. Tokens are resolved only for enabled accounts, the role's configured EAS project and the current enabled installation revision.

A queued recipient reference contains only event ID, internal registration ID and revision. Before transport, `message` rechecks event age, current audience, registration ownership/revision and account availability, then constructs a strict generic hint. Changing account bindings, revoking a registration or disabling an account makes old references unusable. Offer messages also require pending status, authorized funding, open search deadline, online/approved driver, current payout/eligibility and a location heartbeat within sixty seconds. Their TTL ends at the earliest offer expiry, search deadline or event deadline.

Delivery uses a five-minute maximum event age. Device registrations must have renewed within thirty days; native foreground registration refresh is already implemented. These are initial operational defaults, with no new paid service dependency. Expiry suppresses delivery without deleting the installation identity needed for secure recovery. The delivery worker uses this resolver before transport. The resolver does not enforce deletion or retention cleanup of stored tokens. Data retention and account device-management remain separate unfinished work.

Eight PostgreSQL behavior tests cover role/ownership boundaries, minimum queued data, revision/logout/account changes, project mismatch, historical events, independent registration lifetime and offer state/funding/eligibility/location deadlines. Selection is not a transaction with the external push gateway: a state change after the final read cannot recall a submitted message. Therefore messages remain generic hints and the mobile app performs a fresh authorized lookup on tap.

## Account device management

Both apps expose **Account → Manage notification devices**. The shared screen lists enabled registrations for the signed-in account's app project, with platform, a short reference and last-registration time. It never displays a token, installation secret, account identifier or hardware identifier. The short reference distinguishes records without implying a verified model or device name. Revoked registrations disappear from the list; expiring a delivery lease does not erase the record needed for recovery.

`GET /v1/me/notification-devices` returns the minimal list. `DELETE /v1/me/notification-devices/:id` requires a captured revision and mutation UUID. The backend locks the enabled account and owned registration, rejects cross-account/project access and stale revisions, and atomically disables/increments the registration. Exact retries return the original result. Refreshing or transferring that registration prevents an old confirmation from disabling its new state. Turning off an old installation can also free its token for a fresh installation when the previous device proof was lost.

The UI requires explicit confirmation, offers a cancel path, retains the same request key for a retry on that screen and directs stale attempts to refresh. Account-keyed mounts and cancelled list reads prevent old device lists lingering across sign-in changes. The API still enforces ownership independently of UI state. This operation turns off notifications only; it does not revoke the phone's authentication session or remotely erase its data.

Passive foreground/token refresh now respects server revocation. If an existing registration is off, the journal clears its local opt-in intent instead of silently re-enabling it. Registration races are checked again after the mutation: a concurrent revocation cannot produce a confirmed enabled state. Explicit opt-in from that phone is required to register again. After a management action, the current phone refreshes its local notification setting without treating a failed refresh as a failed already-confirmed revocation.

Three new PostgreSQL tests cover minimal owned lists, revision-aware/idempotent revocation, disabled accounts and ownership transfer. Two journal tests cover passive refresh and revocation races, while API/client tests cover authentication, strict fields and request contracts. All 397 workspace tests pass. Browser flows for both apps verify confirmation cancellation, concurrent registration refresh, stale rejection and successful removal after reloading. Both iOS simulator flows pass using synthetic registrations and the local API; the rider initially required a relaunch to load its newly added route. [Rider](screenshots/rider-notification-devices.png) and [driver](screenshots/driver-notification-devices.png) screenshots were visually inspected. Real push/token behavior and Android interaction remain unverified.

## Durable delivery and receipts

Migration `0023_push_deliveries.sql` adds delivery state and shared send-rate windows. It has only been applied to disposable local databases; normal application startup/builds do not migrate a production database. The worker stores one unique delivery per event/installation/revision and atomically enqueues its send job. Queued payloads contain no destination token or personal information. Foreign keys retain the original event and registration needed to audit the delivery.

When enabled, `PushDelivery.handlers` composes with existing financial handlers for terminal ride events. It handles `offer.created`, `ride.matched`, `ride.en_route`, `ride.arrived`, `ride.in_progress`, `ride.completed`, `ride.cancelled`, `ride.no_driver_found`, `ride.no_show`, `ride.interrupted` and `ride.terminated`. It does not replace payment reconciliation, matching or polling. Unknown topics are not silently acknowledged as delivered.

Each send acquires a sixty-second database lease before resolving the current recipient. Completion is conditional on that exact lease. Concurrent invocations cannot send through a live lease; an old invocation cannot overwrite a newer result. A shared PostgreSQL window permits at most one hundred sends per second per configured project in this database. Use separate EAS projects for isolated deployment environments; independent databases do not share rate windows. Rate-limit/transient/unconfirmed failures use the existing outbox backoff, bounded by the event/offer TTL.

The provider ticket and first receipt job commit in one transaction. Accepted tickets enter `receipt`, not a delivered state. Receipt polling starts after fifteen minutes. Pending or temporarily unavailable receipts enqueue another fifteen-minute attempt, fenced by the receipt-attempt number so an old job cannot advance the state again. After twenty-three hours the result becomes `receipt_expired`; it is never assumed successful. Gateway acceptance is recorded as `accepted_by_gateway`, not confirmation that a phone displayed the notification.

Invalid-token results atomically disable only the exact installation revision used by the delivery. A late receipt cannot revoke a newly registered token. Configuration/rejected results remain visible as terminal delivery states with fixed error codes. They need operational review before any deliberate replay; the code does not repeatedly send after a permanent provider rejection. Raw response bodies, credentials and push tokens are excluded from delivery error records.

A recovery sweep, composed into the existing authenticated worker-recovery endpoint, schedules up to one hundred stale unfinished deliveries at a time. It uses a twenty-minute deduplication bucket and preserves receipt-attempt fencing. Expired send jobs resolve to suppressed work; recovery cannot resurrect an old offer. This covers lost wakeups or a delivery whose outbox job exhausted retries during a database outage.

Exactly-once external delivery is not claimed. A gateway may accept a request before the response or database commit is lost. Retrying can send the same generic hint twice; resource collapse IDs and client event deduplication reduce visible duplicates. A state change after the final authorization query cannot recall an already submitted message. Addresses, identity and authoritative trip actions remain behind the authenticated API.

### Enablement and verification

1. Apply reviewed migrations to an isolated staging database through the migration workflow.
2. Configure distinct rider/driver EAS projects, APNs/FCM credentials and native builds. Match each app's public EAS project UUID to its backend project configuration.
3. Enable enhanced push security on those projects and store `EXPO_PUSH_ACCESS_TOKEN` only in backend/worker secrets. Do not use an `EXPO_PUBLIC_` variable for this credential.
4. Keep `EXPO_PUSH_DELIVERY_ENABLED=false` until native registration and permissions are verified. The `true` value requires both configured projects and a valid nonempty server credential; incomplete configuration fails closed.
5. In staging, enable delivery, verify queue wakeups/recovery, complete a synthetic ride and check the delivery/receipt records. Test both platforms, cold-start taps, foreground/background behavior, logout, token refresh and invalid-token receipts before production enablement.

Fourteen real-PostgreSQL orchestration tests cover fan-out deduplication, existing-handler composition, queue timing, revoked registrations, uncertain sends, concurrent leases, stale completions, receipt revision/attempt fencing, terminal errors, recovery, atomic receipt scheduling and the shared send limit across concurrent invocations. API runtime integration runs the payment/cancellation pipeline with push off and on using a fake transport, while configuration and scheduling tests verify enablement and recovery. All 390 workspace tests and eight tooling checks pass. Typechecks, lint, formatting, documentation and import-boundary checks pass; the packaged backend builds and passes its runtime verification. This establishes local behavior, not actual APNs/FCM delivery.

## Remaining integration

1. Verify real native registration, permission/token/logout behavior and delivery/taps on iOS and Android with isolated sandbox credentials.
2. Add local corrupted-storage recovery, token/delivery retention cleanup and operational failure/dead-letter views. The internal dashboard remains in its separate repository.
3. Exercise staging queue latency/load, particularly twenty-second driver offers, and alert on failures and expired/unconfirmed receipts. Polling remains necessary; push does not guarantee dispatch timing.
4. Verify revoked-token behavior and native cold-start consumption with real provider receipts before enabling production delivery.

These remain necessary for the full product. No production push service was enabled by this change.
