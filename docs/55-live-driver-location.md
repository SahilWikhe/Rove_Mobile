# Rider-visible driver location

## Behavior and authorization

The rider trip screen polls `GET /v1/rides/:id/driver-location` every five seconds while focused and foregrounded. Only the owning rider can read their current assigned driver during matched, en-route, arrived, in-progress or interrupted states. Unauthorized roles, other riders, unassigned searches and terminal rides receive 404. Responses use the API’s private/no-store policy.

The response contains only the ride ID and a nullable coordinate/sample-time/expiry record. Offline or disabled drivers, invalid coordinates, missing sample timestamps, samples at least 60 seconds old and timestamps more than five seconds into the future return no location. Pickup/destination privacy remains unchanged; this endpoint exposes no driver credentials or identity fields.

The native map shows a separate blue driver pin and its last-reported time. It does not imply continuous GPS delivery, invent movement or calculate an ETA. The web fallback displays the reporting time. When unavailable, the screen explicitly says so and keeps trip status/support accessible.

## Freshness and lifecycle

Migration `0019_driver_sample_time.sql` adds `drivers.location_sampled_at`. Upload receipt time remains separate. Foreground heartbeats and background grants preserve the device sample timestamp and reject samples older than the latest accepted sample across both upload channels. Availability changes clear sample freshness. Existing rows receive no fabricated backfill: the driver must send a fresh heartbeat.

The server supplies a bounded remaining lifetime. The client subtracts measured request duration using a monotonic clock and removes the pin when that lifetime expires, even if the next request hangs. It also clears on errors, backgrounding, blur, trip changes and completion. This avoids relying on the rider phone’s wall clock.

Authorization is checked against the assignment at each database read. A response already delivered cannot be recalled immediately after reassignment or cancellation; the next read rejects it and the local expiry bounds retained display. Five-second polling is the initial transport, not a claim of instant push updates.

## Verification and remaining work

PostgreSQL tests cover ownership/role boundaries, terminal and unassigned rides, stale/future/missing/invalid samples, disabled/offline drivers and cross-channel timestamp regression. Client tests cover network duration and invalid lifetime inputs. The browser journey verifies a real local synthetic heartbeat becomes visible, read failure clears it, and completion revokes further reads.

Workspace tests, typechecking, lint, packaged API smoke and iOS/Android/web exports passed for this implementation. These checks use synthetic data. No hosted database was migrated. Configured Google SDK builds, physical-device GPS/background delivery, full Figma tracking composition, route geometry and accessibility verification remain release requirements.

The iPhone 17 Pro / iOS 26.5 simulator smoke passed against an accepted synthetic trip. Screenshot inspection confirmed the timestamp and blue driver marker near the gold pickup marker: [native tracking preview](screenshots/rider-native-driver-location.png). This verifies the native display using a synthetic heartbeat and Apple map tiles, not physical GPS or production Google Maps.
