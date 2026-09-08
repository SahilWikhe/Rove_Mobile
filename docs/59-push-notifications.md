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

## Remaining integration

1. Authenticated registration per installation/account/app/environment; ownership transfer and logout revocation with generation fencing. Registration must not let a stale logout or receipt disable a newer account's token binding.
2. Transactional event fan-out to authorized recipients, durable delivery attempts and receipt jobs. Recheck active ownership/offer expiry before send; never reserve a driver through push.
3. Per-project throughput controls and operational visibility for failures/dead letters. Do not replay expired historical offers when enabling the consumer.
4. Explicit native notification permission, token refresh, logout cleanup and authenticated deep-link handling. Fetch current resource data before showing details or offering actions.
5. Synthetic integration tests across API, worker and mobile handlers, then real iOS/Android sandbox delivery and revoked-token verification.

These remain necessary for the full product. Foreground polling continues to provide current trip and offer data in the meantime. Push will supplement that path, not guarantee dispatch timing or availability.
