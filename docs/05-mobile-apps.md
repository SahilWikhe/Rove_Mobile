# Mobile applications and user experience

Status: implemented rider/driver apps plus requirements for unfinished acceptance; see [current checkpoint](18-implementation-status.md). Both applications use the same supported Expo SDK and React Native version, but have separate app identifiers, permissions, release channels and store listings.

## Consumer rider application

Organize around destination search, pickup confirmation, service/quote selection, payment method, searching/matched state, active trip, receipts/history and profile/help. Consumer onboarding and booking require no institutional membership or sponsor. Scheduled rides, recurring plans and caregiver relationships are optional later features.

Home starts with where the rider wants to go. Show the quoted price/terms before requesting; then show searching, offer progress where appropriate, matched driver/vehicle and pickup ETA. Handle no driver found with a clear recovery choice, not an endless spinner. Avoid displaying prototype animation as live data. Explicitly label unavailable ETA, stale location and pending commands; offer support during an active ride.

For future delegated booking, caregiver capabilities are separate: view, receive updates, request, cancel and manage details. A grant can expire or be revoked. Clearly display whom a person acts for and clear scoped caches on context changes. Location access follows the current ride/grant, not possession of an old link. This feature does not gate ordinary personal booking.

## Driver application

Organize around online/offline availability, incoming timed offers, accepted pickup/active trip, earnings/history and account/eligibility. Show an offer countdown derived from server expiry and require server acknowledgement of acceptance. Declined/expired offers must disappear; a late tap cannot claim an already reassigned trip. Before acceptance, send only coarse route areas, ETA/distance, estimated earnings/terms, expiry and necessary service capabilities. Exclude rider identity/history, exact endpoints/coordinates, medical information and payer labels at the API serialization boundary. Reveal authorized assignment details only after committed acceptance, and revoke access when assignment ends or changes.

Tracking has two explicit purposes. Online discovery provides private-to-platform position/heartbeat for finding available drivers. Accepted-trip tracking provides rider-visible position under ride authorization. Trip completion stops that ride's sharing; online discovery continues only while the driver intentionally stays online. Going offline, logout or revocation stops discovery; expired heartbeats remove the driver from matching. Reject superseded trip sessions even if the phone has queued samples.

Drivers must not interact with complex forms while moving. Minimize required taps, avoid decorative motion on operational screens, and provide a safe way to report an issue when stopped. The app is not an emergency-response or medical-monitoring system.

## Feature organization guideline (not an exact directory inventory)

```text
src/
  app/                    # Route composition only
  features/
    rides/
      screens/
      components/
      hooks/
      queries.ts
      mutations.ts
      tests/
    profile/
    support/
  platform/               # Location, secure storage, notifications, linking
  providers/              # Session, query client, theme
```

Routes compose features; components render; hooks coordinate UI; platform adapters wrap native behavior. Backend policies remain authoritative even if the client duplicates a rule to provide fast validation. Share a component only if its behavior, accessibility and lifecycle actually match both apps.

The shared typed API client and focused polling/WebSocket controllers load fetched state; React state holds screen data and forms. Account-keyed mounts, request generations and abort signals fence late reads. Sign-out clears the current auth scope and subscriptions and runs notification/tracking cleanup; uncertain operation journals remain scoped for recovery rather than being silently discarded. No TanStack Query store or synthetic tenant is required.

## Authentication decision and device storage

Auth0 is selected for direct setup under ADR-005. Use separate public Native clients for rider and driver in the same staging tenant, with a shared API audience. Retain the existing Expo AuthSession PKCE integration pending verification in development builds. Verify OAuth PKCE, callback allowlists, session refresh/revocation, account recovery, staff MFA, account deletion, operational cost, and applicable data agreements. Record verification evidence against ADR-005.

Use OS secure storage for session material supported by the provider, never AsyncStorage or public environment variables for secrets. No mobile bundle contains a database connection string or privileged provider key. Device storage can be lost or persist differently across reinstall; the server remains the authority for account/session state. [Expo authentication](https://docs.expo.dev/guides/authentication/)

Offline trip data needs a separate storage decision. For the first prototype, use synthetic data. Before real data, choose an encrypted storage implementation, scoped device keys, expiry, backup exclusions, and logout/revocation cleanup. Do not assume standard SQLite or general key-value storage is encrypted. Keep the retained offline view limited to current assigned work; retention and revoked-device behavior must be documented.

## Offline commands and synchronization

Distinguish viewing cached data from successfully changing the server. The driver can record a pending milestone locally with command id, assignment id/version, client occurrence time and retry metadata. Show `Pending sync` until acknowledged. The API evaluates current authorization and permitted state, records server receipt time, and either accepts the command or returns a conflict for operator review.

Never replay an old assignment command into a new assignment. Ordered milestones carry a monotonic local sequence; gaps/conflicts trigger reconciliation. Bound queue age/size and preserve idempotency keys. Quotes, bookings, going online, offer acceptance and financial changes require server confirmation. Do not queue an acceptance to replay after its offer expires. Offline UI may display prior trip data but cannot claim a match or successful payment.

## Background tracking acceptance test

Use development/native builds, not Expo Go, for background-location evaluation. Platform restrictions and user actions can stop updates; do not promise uninterrupted tracking after force-stop or termination. [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/)

Test foreground, locked screen for at least a realistic ride duration, background navigation handoff, low-power mode, denied/revoked permissions, approximate location, airplane mode/reconnect, device reboot, user force-stop, and expired login. Include multiple Android vendors, because background policies vary. Record OS/app/build version, permission state, timestamp gaps and measured battery consumption.

Sample schema: assignment/session id, session epoch, sequence, recorded time, latitude/longitude, accuracy, optional speed/heading, plus server received time. Validate coordinate bounds and maximum batch size; reject implausible ages/future timestamps and rate-limit uploads. Location is untrusted input, not a billing meter or proof of driver eligibility.

A new session epoch resets sequence interpretation safely. Within an epoch, stale/out-of-order samples cannot replace the latest position. Display freshness using both device-recorded and server-received information. Current rider location expires at a server-bounded lifetime of at most 60 seconds; client request duration is deducted and expired pins are removed. Three-second driver GPS requests and socket invalidations do not guarantee that cadence on physical devices. Do not continuously re-run paid route calculations for every GPS sample.

## Navigation and notifications

Use Google Maps/Places/Routes through explicit adapters. Restrict native map keys by platform application identity and API, and server keys by appropriate server restrictions. Native map keys are distributable credentials with restrictions, not backend secrets. Check attribution, storage and caching terms for chosen APIs before implementation.

Driver directions use the in-app Google Navigation SDK after a fresh authorized trip read. The current session stops on background/blur; continuous lock-screen guidance remains unfinished. Avoid sensitive free text in destination labels. Incoming offer delivery must use realtime or suitably fast foreground refresh with an expiry-aware fetch; push alone cannot guarantee timely delivery or reserve a driver.

Push messages are a hint to refresh authoritative data. Payloads contain opaque references and generic text such as `Your ride has an update`, not addresses or treatment details visible on a lock screen. Deep links require authentication and a fresh resource authorization check. Register tokens per installation/user/environment, remove invalid tokens from receipts, and unlink on logout. SMS fallback is an operational decision with consent, cost and privacy implications.

## Accessibility and design

Carry the black/gold brand into usable interfaces with tested contrast. Support large text without clipped controls, screen readers, reduced motion, clear focus order and platform touch-target guidance. Never encode coverage or danger using color alone. Give errors in plain language with a recovery action; make confirmation/cancellation scopes explicit.

Test older supported devices, small screens, large fonts, dark/light appearance decisions, slow networks, and long names/addresses. Use loading skeletons only where they preserve meaning; avoid animated maps distracting from pickup instructions. App-store privacy disclosures must match actual SDK collection.

Build and release mechanics are described in [CI/CD](08-cicd-and-environments.md). Institution dashboards are not an embedded required tab or prerequisite for either native app; their UI/release lifecycle belongs to the [separate B2B product](14-b2b-product-boundary.md).

## Detailed screen contract

The [mobile design contract](16-mobile-design-contract.md) is the frame-by-frame handoff for both supplied Figma files, shared visual components, approved copy/scope changes and proposed auth/payment/onboarding/error/start-trip screens. Follow its consumer-funded default and remove Pro subscription/100%-fare content. Scheduling UI and backend admission use [default-off scheduling flags](17-scheduling-feature-flags.md), including a capabilities response and grandfathered existing-work views. Scheduled service requirements do not permit sensitive pre-acceptance disclosure.

## Driver account activity

`GET /v1/drivers/me/activity` returns the authenticated driver's `completedTrips`, `acceptedOffers` and `joinedAt`. It rejects other roles and disabled/missing driver accounts. Counts use retained completed rides assigned to that driver and retained accepted offers, including accepted offers whose trip later cancelled; they are not ratings, response rates or payment totals. No subject, rider information or exact route is returned.

Account loads this alongside vehicle/document/payout summaries and refreshes on focus or pull-down. Failed activity reads remove prior values and display an unavailable message. Registration month uses UTC. Deploy migration 0045 (partial aggregate indexes) and the API before the mobile release; an older API remains usable with activity unavailable. No hosted migration or physical-device acceptance is established by local tests.
