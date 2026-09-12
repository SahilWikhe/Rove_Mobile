# Rider-visible driver location

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

## Behavior and authorization

The rider trip screen reloads `GET /v1/rides/:id/driver-location` on authenticated WebSocket invalidations while focused and foregrounded. Healthy location-capable sockets stop polling; five-second polling remains a fallback when unavailable or unsupported. See [realtime transport](realtime-messaging.md). Only the owning rider can read their current assigned driver during matched, en-route, arrived, in-progress or interrupted states. Unauthorized roles, other riders, unassigned searches and terminal rides receive 404. Responses use the API’s private/no-store policy.

The response contains only the ride ID and a nullable coordinate/sample-time/expiry record. Offline or disabled drivers, invalid coordinates, missing sample timestamps, samples at least 60 seconds old and timestamps more than five seconds into the future return no location. Pickup/destination privacy remains unchanged; this endpoint exposes no driver credentials or identity fields.

The native map shows a separate blue driver pin and its last-reported time. It does not imply continuous GPS delivery, invent movement or calculate an ETA. The web fallback displays the reporting time. When unavailable, the screen explicitly says so and keeps trip status/support accessible.

The camera follows fresh driver samples during pickup and travel until the rider pans or selects Show full trip. Follow driver restores following. Missing/stale coordinates do not animate invented movement.

## Freshness and lifecycle

Migration `0019_driver_sample_time.sql` adds `drivers.location_sampled_at`. Upload receipt time remains separate. Foreground heartbeats and background grants preserve the device sample timestamp and reject samples older than the latest accepted sample across both upload channels. Availability changes clear sample freshness. Existing rows receive no fabricated backfill: the driver must send a fresh heartbeat.

The server supplies a bounded remaining lifetime. The client subtracts measured request duration using a monotonic clock and removes the pin when that lifetime expires, even if the next request hangs. It also clears on errors, backgrounding, blur, trip changes and completion. This avoids relying on the rider phone’s wall clock.

Authorization is checked against the assignment at each database read. A response already delivered cannot be recalled immediately after reassignment or cancellation; the next read rejects it and the local expiry bounds retained display. Assignment/message invalidations trigger fresh access checks; a dropped event is bounded by reconnect catch-up and local expiry. Neither transport guarantees continuous physical GPS delivery.

## Verification and remaining work

PostgreSQL tests cover ownership/role boundaries, terminal and unassigned rides, stale/future/missing/invalid samples, disabled/offline drivers and cross-channel timestamp regression. Client tests cover network duration and invalid lifetime inputs. The browser journey verifies a real local synthetic heartbeat becomes visible, read failure clears it, and completion revokes further reads.

Workspace tests, typechecking, lint, packaged API smoke and iOS/Android/web exports passed for this implementation. These checks use synthetic data. Provider staging has migrations through 0030, including location notifications. Google SDK maps and camera following are implemented. Physical-device GPS/background delivery, full Figma/accessibility acceptance and end-to-end provider behavior remain release requirements.

Historical initial-map evidence: the iPhone 17 Pro / iOS 26.5 simulator smoke passed against an accepted synthetic trip. Screenshot inspection confirmed the timestamp and blue driver marker near the gold pickup marker: [native tracking preview](screenshots/rider-native-driver-location.png). This verifies the native display using a synthetic heartbeat and Apple map tiles, not physical GPS or production Google Maps.
