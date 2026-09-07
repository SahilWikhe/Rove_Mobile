# Mobile applications and user experience

Status: target implementation. Both applications use the same supported Expo SDK and React Native version, but have separate app identifiers, permissions, release channels and store listings.

## Rider and caregiver application

Organize around Home/next ride, schedule and history, ride detail/status, caregiver relationships, and profile/help. A person acting for someone else must see the active rider identity clearly. Changing that context clears scoped queries so one person's trip does not flash in another person's screen.

Home shows the next leg, its confirmed/requested status, pickup window, return-plan status, and an accessible support action. Avoid displaying a prototype animation as if it were live operational data. Explicitly label unavailable ETA, stale location, unconfirmed coverage and pending commands.

Caregiver capabilities are separate: view rides, receive updates, request rides, cancel rides, and manage details. A grant can be narrow, expiring or revoked. Driver location access follows current ride and grant permissions, not possession of an old share link.

## Driver application

Organize around today's work, offer/assignment details, active leg, operational history, and account/eligibility. Use large intentional controls for milestones. Show rider assistance requirements necessary for service, pickup instructions and navigation; do not expose diagnoses or unrelated history.

Tracking starts for authorized active work and stops at completion, cancellation/reassignment, logout or loss of authorization. Server-side expiration prevents a malfunctioning app from extending access indefinitely. Reject data from a superseded assignment even if its device still has queued samples.

Drivers must not interact with complex forms while moving. Minimize required taps, avoid decorative motion on operational screens, and provide a safe way to report an issue when stopped. The app is not an emergency-response or medical-monitoring system.

## Feature structure

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

TanStack Query owns fetched state. Local React state owns transient form/UI state. Introduce a small global store only for concrete cross-screen local state, not as a second database. Query keys include actor/tenant/rider scope; logout clears queries, tokens, subscriptions, push registrations and offline state.

## Authentication decision and device storage

Evaluate managed authentication with an Expo development build before accepting a provider. Candidate evaluation includes Neon Auth and a managed OIDC provider with documented Expo support. Verify OAuth PKCE, callback allowlists, session refresh/revocation, account recovery, staff MFA, account deletion, operational cost, and applicable data agreements. Record the decision in an ADR.

Use OS secure storage for session material supported by the provider, never AsyncStorage or public environment variables for secrets. No mobile bundle contains a database connection string or privileged provider key. Device storage can be lost or persist differently across reinstall; the server remains the authority for account/session state. [Expo authentication](https://docs.expo.dev/guides/authentication/)

Offline trip data needs a separate storage decision. For the first prototype, use synthetic data. Before real data, choose an encrypted storage implementation, scoped device keys, expiry, backup exclusions, and logout/revocation cleanup. Do not assume standard SQLite or general key-value storage is encrypted. Keep the retained offline view limited to current assigned work; retention and revoked-device behavior must be documented.

## Offline commands and synchronization

Distinguish viewing cached data from successfully changing the server. The driver can record a pending milestone locally with command id, assignment id/version, client occurrence time and retry metadata. Show `Pending sync` until acknowledged. The API evaluates current authorization and permitted state, records server receipt time, and either accepts the command or returns a conflict for operator review.

Never replay an old assignment command into a new assignment. Ordered driver milestones carry a monotonic local sequence; gaps/conflicts trigger reconciliation. Bound queue age and size. A server retry must preserve the same idempotency key. Rider bookings, assignment acceptance and financial changes require server confirmation; do not optimistically display guaranteed coverage or payment success offline.

## Background tracking acceptance test

Use development/native builds, not Expo Go, for background-location evaluation. Platform restrictions and user actions can stop updates; do not promise uninterrupted tracking after force-stop or termination. [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/)

Test foreground, locked screen for at least a realistic ride duration, background navigation handoff, low-power mode, denied/revoked permissions, approximate location, airplane mode/reconnect, device reboot, user force-stop, and expired login. Include multiple Android vendors, because background policies vary. Record OS/app/build version, permission state, timestamp gaps and measured battery consumption.

Sample schema: assignment/session id, session epoch, sequence, recorded time, latitude/longitude, accuracy, optional speed/heading, plus server received time. Validate coordinate bounds and maximum batch size; reject implausible ages/future timestamps and rate-limit uploads. Location is untrusted input, not a billing meter or proof of driver eligibility.

A new session epoch resets sequence interpretation safely. Within an epoch, stale/out-of-order samples cannot replace the latest position. Display freshness using both device-recorded and server-received information. Proposed prototype threshold: label location stale after 30 seconds without a current sample; re-evaluate against field results before making a service promise. Do not continuously re-run paid route calculations for every GPS sample.

## Navigation and notifications

Use Google Maps/Places/Routes through explicit adapters. Restrict native map keys by platform application identity and API, and server keys by appropriate server restrictions. Native map keys are distributable credentials with restrictions, not backend secrets. Check attribution, storage and caching terms for chosen APIs before implementation.

Initially hand off navigation to Google Maps or Apple Maps using a validated destination. Confirm Rove continues permitted background tracking while navigation is open. Avoid putting diagnoses or sensitive free text in destination labels.

Push messages are a hint to refresh authoritative data. Payloads contain opaque references and generic text such as `Your ride has an update`, not addresses or treatment details visible on a lock screen. Deep links require authentication and a fresh resource authorization check. Register tokens per installation/user/environment, remove invalid tokens from receipts, and unlink on logout. SMS fallback is an operational decision with consent, cost and privacy implications.

## Accessibility and design

Carry the black/gold brand into usable interfaces with tested contrast. Support large text without clipped controls, screen readers, reduced motion, clear focus order and platform touch-target guidance. Never encode coverage or danger using color alone. Give errors in plain language with a recovery action; make confirmation/cancellation scopes explicit.

Test older supported devices, small screens, large fonts, dark/light appearance decisions, slow networks, and long names/addresses. Use loading skeletons only where they preserve meaning; avoid animated maps distracting from pickup instructions. App-store privacy disclosures must match actual SDK collection.

Build and release mechanics are described in [CI/CD](08-cicd-and-environments.md).
