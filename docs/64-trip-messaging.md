# Rider–driver messaging

## UI and contact scope

Both apps have a Messages tab, unread dot/count, inbox, assignment thread, quick replies,
and an entry point from trip details. Reference nodes: driver `4:2`/`4:51`, rider
`8:146`/`9:20`. The current champagne-gold and subtle translucent surfaces override the
older Figma colors. A generic avatar is reused; sample ratings, phone calls, medical
labels and example messages are not product data. Keyboard avoidance, safe areas and
48-point touch targets take precedence over fixed Figma dimensions.

Sending is permitted only for the owning rider and currently assigned driver after
acceptance, in matched/en-route/arrived/in-progress/interrupted states. The accepted
offer ID identifies the conversation. Reassignment never transfers prior message text
to another driver. Ended trips are read-only; messages older than 30 days are excluded
from API results. This is a visibility window, **not a promise of permanent deletion**.
Automatic permanent deletion remains disabled pending owner approval of retention,
including backup expiry. Reports remain separate support records.

The report menu accepts harassment, safety, spam or other reasons. Reporting creates one
support request per reporter/conversation and blocks further sends by either party.
The interface directs emergencies to local emergency services. This is not a monitored
emergency channel or an automated moderation service. Text only: no attachments,
phone numbers, calls, delivery/read promises or post-trip direct contact are added.

## Entry recovery and compact composition

Inbox and conversation routes wait for account restoration before showing private content. Signed-out entries offer Continue to your account; after setup the user can open Messages. Signed-in conversation entries validate the UUID before mounting a thread loader, and incomplete links offer Open Messages. Thread state remains keyed by account and conversation. Server ownership checks remain authoritative.

Browser acceptance covers both signed-out entry routes, recovery through account setup into Messages without private thread requests, and both composers at 320×360 with long drafts. Input and Send remain inside the viewport with at least 48-point heights. This reduced viewport is not an actual native keyboard test. The rider Android signed-out inbox was visually inspected. Signed-in malformed-link recovery and physical keyboard/screen-reader acceptance remain to be exercised natively.

## Accessibility

Each message bubble exposes its sender, full message text, localized date/time and, for outgoing messages, Sent as one accessible label. Sent means accepted by the server; it does not promise delivery or reading. Inbox buttons include unread count, latest message preview and read-only status. Quick replies explain that they fill a draft rather than send immediately. Send exposes disabled/busy state, and the report control exposes whether its menu is expanded.

The synthetic two-person browser journey verifies outgoing versus incoming labels, empty/draft send eligibility, report expansion, persisted exchange, lost-response retry and WebSocket updates. Native VoiceOver/TalkBack reading order, pronunciation and keyboard interaction still require device acceptance; browser assertions do not prove those behaviors.

## API and persistence

Migration `0027_trip_messaging` adds message, read-cursor and report tables. No new
messaging vendor or credentials are required. Apply the versioned migration before
deploying the API or distributing these app builds. Do not migrate during startup.

- `GET /v1/conversations` returns 50 conversations ordered by ride creation with a
  precise timestamp/ID cursor; all rows are scoped to the authenticated participant.
- `GET /v1/conversations-unread` returns the account's unread count.
- `GET /v1/rides/:id/conversation` resolves an authorized accepted assignment.
- `GET /v1/conversations/:id` returns at most 200 retained messages in sequence order.
- `POST .../:id/messages` accepts text and a caller-generated request UUID. Retrying
  that UUID returns the original message after reauthorization. Changed content conflicts.
- `POST .../:id/read` advances the account's cursor monotonically to an actual message.
- `POST .../:id/report` closes sending and creates the support request atomically.

Every operation checks the account and assignment on the server. Send/report operations
lock the ride so state changes, reports and simultaneous sends cannot bypass policy.
Text is trimmed and limited to 1,000 characters; sends are capped at 10 per minute per
sender/conversation and 200 per conversation. HTTP rate limits also apply. Text is not
copied to command journals, audit metadata, notification payloads or application logs.
This is authenticated server-stored messaging, not end-to-end encryption.

## Refresh, notifications and failure behavior

Authenticated WebSocket invalidations refresh threads, inboxes and unread counts while focused and foregrounded. Healthy sockets stop message polling. When disconnected, threads fall back to three-second polling and inboxes/unread counts to ten seconds; see [realtime transport](realtime-messaging.md). Failure backs off; private content is removed when a read fails,
the screen loses focus, the app backgrounds or the account changes. Drafts remain only in
screen memory. A send with a lost response can be retried with the same UUID while the
screen remains open. A new composed message is a new action. Reading a conversation marks
its returned messages read; this does not assert the user read each word.

A committed send writes a durable `message.created` outbox event containing only a message
reference. The existing push worker sends a generic new-message hint to the other party.
It rechecks assignment, disabled accounts, reports and unread status immediately before
sending. Notification taps reauthorize the conversation before navigation. Push requires
the existing Expo project/provider and permission setup; foreground exchange does not.
The local synthetic worker never sends notifications. Delivery is not guaranteed and
physical-device push verification remains part of release testing.

## Verification

Real disposable-Postgres tests cover concurrent retries, changed retries, outsider/role/
disabled-account access, reassignment, terminal/expired history, reporting, send limits,
read cursors, completion races, rollback and private push targeting. HTTP tests validate
request schemas and no-store responses. The browser E2E exchanges messages between both
apps, drops one successful send response, proves only one persisted message, and reports
the conversation. Ordinary CI runs this synthetic test without external provider billing.

Native simulator and physical-device checks should cover keyboard open/close, long text,
large fonts, foreground recovery, back navigation and account switching. These are separate
from proving cloud deployment and real push delivery.

### Native Android foreground evidence

On September 12 the driver sent through the native composer and received a delayed synthetic rider reply while the conversation stayed open. A transparent local proxy captured the authenticated connection's ready/message-change events, and Maestro verified the remote text before navigating back to the trip. The same scenario then completed the ride and rider paid receipt (125.4 seconds, zero failures). This proves local foreground WebSocket delivery to the Android driver; it does not establish native rider receiving, iOS, push, background/locked-phone delivery or live Auth0 acceptance. Run instructions and evidence requirements are in [native messaging acceptance](08-cicd-and-environments.md#native-foreground-messaging-evidence).

### Both Android participants verified

The expanded September 12 run passed in 149.513 seconds with zero failures. Both native Android participants sent through their composers and received delayed synthetic counterpart replies while remaining in the conversation. Recorded ready WebSocket connections received the corresponding messages.changed events before the native visible-text assertions. The driver also saw the rider message after reopening, and the ride continued through the paid receipt. Artifacts are under reports/native-trip-android/android-driver-details/2026-09-12_205948. This extends the earlier driver-only evidence; it does not prove background, reconnect, physical-device or live-provider acceptance.

The new iOS trip runner reached the driver conversation but failed at the composer assertion with a debug warning banner overlapping that area. The cause remains under investigation; no iOS messaging pass is recorded.

The next iOS run used the existing message-input test ID and successfully sent the driver message and displayed the delayed reply. Its native accessibility tree groups each bubble's sender, body and timestamp; the exact-body assertion therefore failed despite the visible reply. The shared scenario now matches the message body within that grouped label. This preserves the spoken accessibility content and does not suppress debug warnings. Full iOS journey acceptance still requires a passing run.

### Complete iOS acceptance

The corrected shared scenario passed on iOS 26.5 in 116.546 seconds with zero failures. Both native participants sent and received delayed counterpart replies, the driver recovered the rider message on reopening, and the ride completed through the paid synthetic receipt. Screenshots, JUnit and WebSocket/peer logs are retained under reports/native-trip-ios/details/2026-09-12_211812. This closes the local foreground iOS trip/message check; reconnect, background/locked-phone and full provider acceptance remain separate.

### iOS foreground reconnect

The optional outage variant passed in 142.413 seconds, including complete-trip and paid synthetic receipt checks. With the rider conversation open, HTTP fallback recovered a message during an eight-second WebSocket outage. After a fresh ready socket, a later reply produced messages.changed on that connection and appeared natively. Evidence is retained under reports/native-trip-ios/details/2026-09-12_212652. This is iOS foreground recovery; Android outage acceptance and background/physical-device delivery remain open.
