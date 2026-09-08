# Ride service selection

Implemented September 8, 2026. This is an intermediate mobile checkpoint, not approval to accept production rides.

## Rider behavior

After selecting pickup and destination, the rider chooses Standard or Accessible. Standard is the initial selection. The choices reuse the shared black/charcoal, Manrope and gold selected-state theme. Address search is hidden once both endpoints are selected; either endpoint can still be edited.

Each quote request includes the selected service. Changing service cancels any pending lookup/quote through the existing request-generation guard, clears obsolete results and requires a fresh fare review. Confirmation displays the returned quote's service, route and fare. Booking submits the quote ID, so a local selection cannot change a server-owned quote. The existing expiry and durable booking-recovery behavior remains in place.

The choice controls expose native radio state and the web `aria-checked` state. Descriptions do not promise a driver, certified equipment, an arrival time or a service-specific price. Accessible means the matching engine restricts candidates to drivers with the accessible service eligibility recorded on their profile. Eligibility approval and vehicle capability verification are still launch requirements.

## Matching and verification

Postgres-backed matching tests now cover:

- Accessible offers reach eligible accessible drivers and can be accepted.
- Standard drivers receive no accessible offer; the search ends with `no_driver_found` when no eligible driver is available.
- Losing accessible eligibility during directions lookup prevents offer creation.
- Losing accessible eligibility after an offer prevents assignment.

Existing transaction-level filters and acceptance checks satisfy those tests without changing matching policy. Client transport coverage checks that the accessible service and cancellation signal are forwarded without a booking mutation or automatic retry. Existing latest-request tests cover obsolete quote results after cancellation.

The local synthetic browser flow was exercised at 390×844: select Home and Work, select Accessible, review the returned Accessible quote, return to editing, select Standard and obtain a new Standard quote. Radio states were checked in the browser accessibility snapshot. No ride was requested and no real payment or production database was used.

## Remaining work

The confirmation screen has since been adapted to Figma frame `5:89`; see [confirmation design](45-booking-confirmation-design.md). Device screen-reader, large-font and full Android/iOS booking journeys still need verification. Service-specific operational criteria, approved rates and verified vehicle onboarding remain outstanding. Synthetic fares are fixtures; equal fixture prices do not establish a production pricing policy.
