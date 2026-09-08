# Push notifications

## Current checkpoint

The server now has a typed `PushProvider` interface and an Expo HTTPS adapter for sending one hint and checking its receipt. Seven transport tests verify outbound content, expiry, errors, invalid devices and bounded responses. This is the transport foundation, not an enabled notification service. No real tokens, Expo credentials or external sends were used. Existing notification/review outbox events remain unhandled until their durable consumers are implemented; they are not acknowledged as delivered by this change.

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

## Remaining integration

1. Verify the wired native registration with real app projects/credentials and add account device-management recovery and registration lifetime policy.
2. Transactional event fan-out to authorized recipients, durable delivery attempts and receipt jobs. Recheck active ownership/offer expiry before send; never reserve a driver through push.
3. Per-project throughput controls and operational visibility for failures/dead letters. Do not replay expired historical offers when enabling the consumer.
4. Add authenticated notification-tap/deep-link handling and verify OS permission/token/logout behavior on both platforms. Fetch current resource data before showing details or offering actions.
5. Synthetic integration tests across API, worker and mobile handlers, then real iOS/Android sandbox delivery and revoked-token verification.

These remain necessary for the full product. Foreground polling continues to provide current trip and offer data in the meantime. Push will supplement that path, not guarantee dispatch timing or availability.
