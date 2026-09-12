# Real-time messaging and rider location

Both apps use an authenticated WebSocket at `/v1/realtime`. The socket pushes `messages.changed` events; the client immediately reloads the authorized conversation, inbox and unread count over HTTPS. Sending still uses the existing durable, idempotent HTTPS operation. A healthy connection does not poll for messages. If the transport is unavailable, bounded foreground polling preserves usability until reconnect succeeds.

## Delivery and access

- Persist messages in Postgres before notifying. Migration `0028_message_notifications.sql` installs transaction-bound notifications for messages, reads, reports, assignment changes and relevant account changes. Rolled-back writes cannot produce delivery events.
- Each active function instance holds one direct Postgres LISTEN session and distributes notifications to its own authenticated sockets. Database notifications reach every listening instance. No in-memory registry is treated as shared or durable state.
- Socket payloads contain only an event type. Message text, locations and participant identifiers are fetched through existing authorized API routes. Database notifications contain recipient IDs only.
- Send the Auth0 access token in the first socket frame, never a URL. The server verifies it through the same authenticated profile boundary, rejects disabled/unsupported accounts and rechecks access every 30 seconds. HTTPS reads reauthorize independently.
- Validate browser origins. Native Android's automatically generated API origin is allowed; native clients without Origin still require authentication. Never enable arbitrary browser origins.
- Close idle unauthenticated sockets, limit frame sizes and buffered output, heartbeat connections, and bound connection lifetime to 100 seconds within the 120-second function limit. Reconnect with backoff and acquire a fresh token.
- After first connect, reconnect or app foregrounding, reload durable state. A database listener failure closes sockets to trigger recovery. Backgrounding or leaving the subscribed screens releases subscriptions.

## Rider location transport

Migration `0030_driver_location_notifications.sql` publishes post-commit invalidations to the assigned active rider when driver location/freshness/availability changes. The server requires the message and location triggers before advertising readiness, including the `driver-location` capability. `driver.location.changed` carries no coordinates or ride ID. The client fetches current authorized coordinates through HTTPS; message/assignment changes also invalidate location access. Unrelated location events do not reload message lists.

A healthy location-capable socket replaces the five-second location poll. Disconnected or older servers retain that fallback. Driver GPS uploads request three-second native intervals, subject to the OS, signal and permissions; sockets cannot create samples the device did not deliver. Expiry clears stale location independently. See [driver uploads](20-driver-location.md) and [rider tracking](55-live-driver-location.md).

## Staging and production setup

Apply versioned migrations through 0030 to the explicitly selected environment before enabling the endpoint. Keep the existing pooled `DATABASE_URL` for normal queries. Add `REALTIME_DATABASE_URL`, the direct, non-pooled connection to the same database with the same restricted runtime role and `sslmode=verify-full`. Validation rejects a different database, role, endpoint or insecure TLS configuration. Never use a schema-owner credential for realtime.

Vercel serves `api/realtime.mjs` as an HTTP server with WebSocket upgrades and the `/v1/realtime` rewrite. Fluid Compute must be enabled. No additional realtime vendor is required. Browser acceptance builds need their exact origin in `ALLOWED_ORIGINS_JSON`.

An absent realtime database setting leaves the endpoint unavailable and the apps in fallback mode; this is not successful realtime activation. Verify an actual WSS handshake, authenticated delivery across separate connections, reconnect catch-up and authorization after deployment. Dedicated synthetic staging accounts should be used for hosted checks.

One direct connection is used per active server instance, not per user. Account for Neon connection capacity, Vercel function usage and transfer costs; staging usage is not inherently free. Persistent listeners may affect database idle behavior. Check concurrency limits and usage before a public launch.

## Verification

The API suite exercises two separate WebSocket servers against disposable Postgres, committed versus rolled-back writes, unrelated-account isolation, idempotent retry, read/report changes, missed-history recovery, disabled accounts and listener failure. Client tests cover shared sockets, fresh-token reconnect, foreground/background cleanup, invalidations during reads and retry-after handling. The browser messaging test requires ready frames and pushed changes while exercising sends, lost-response retries and reporting.

Dedicated Auth0 staging accounts also passed hosted messaging delivery, retry, reads and reconnect recovery. Local cross-instance tests cover location invalidation and the browser ride journey covers moving samples; full hosted physical GPS acceptance is still open. These checks do not establish background push delivery, unlimited scale, production activation or physical-device acceptance. Message retention/deletion policy remains separate from real-time transport.

## References

- [Vercel WebSockets](https://vercel.com/docs/functions/websockets)
- [Neon pooling and direct-session requirements](https://neon.com/docs/connect/connection-pooling)
