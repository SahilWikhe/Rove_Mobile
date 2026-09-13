# Mobile design contract and approved Figma changes

Status: founder-approved direction from September 7, with implemented amendments through September 12, 2026. Source frame mappings and future requirements are distinct from the implementation notes below; full Figma parity is not claimed. Follow this contract together with [mobile architecture](05-mobile-apps.md), [scope](01-product-scope.md) and [feature flags](17-scheduling-feature-flags.md).

## Design authority and reference files

| Reference | Role |
| --- | --- |
| [Rove Ride App](https://www.figma.com/design/8S3vQl4P3bVTLSKgxPDghv/Rove-Ride-App?node-id=0-1) | Rider layout, component patterns, visual theme and existing flow reference |
| [Rove Driver App](https://www.figma.com/design/1IzXAu67Sogja8SvfPtOlB/Rove-Driver-App?node-id=0-1) | Driver layout, offer sheet, trip controls, earnings and account reference |
| [Rove Ops Dashboard](https://www.figma.com/design/GcQbsY8y7NN7Slys7ZAvHq/Rove-Ops-Dashboard?node-id=0-1) | Internal staff design reference, implemented in its separate repository |

Precedence: latest approved product decisions in this document override conflicting Figma copy or behavior. Otherwise preserve the supplied design language and applicable screen structure. Do not treat example names, prices, clocks, medical coverage, vehicle credentials or subscription terms as live data or approved business policy. Future Figma edits need a reviewed change record before changing product scope.

Review evidence: page metadata for both mobile files and rendered rider Home (`2:12`) and driver Ride request (`2:2`) were inspected. File metadata describes Manrope and 390×844 base screens; some rider screens scroll beyond that height. Exact variable extraction was blocked by the connected Figma account's tool quota. Therefore no invented hex codes or measured font weights are declared canonical. At implementation, retrieve actual fills, typography, spacing, radii and component variants, record the source node/review date, and map them into tested tokens. Temporary asset URLs must not be committed.

## Approved deviations

| Decision | Implementation requirement |
| --- | --- |
| Consumer-funded rides first | Replace default NEMT/Medicaid/covered-$0 content with the rider's real quote, payment method and receipt. Institutional sponsorship remains a separate later extension. |
| Scheduling is retained behind flags | Keep one-time advance, weekly and monthly scheduling as planned optional modules, all off initially. Hide their creation entry points and enforce restrictions in the API; do not delete the future design references. |
| Remove Rove Pro | Remove the $199/month subscription, renewal dates, subscription account menu, zero-commission and “keep 100% of fares” promises. Do not add subscription billing or an alternative subscription price. |
| Driver offer privacy | Do not transmit exact pickup/drop-off addresses, rider identity/history, medical information or payer/coverage details before acceptance. Show operationally necessary coarse route/ETA and verified service requirements. |
| Fill missing journeys | Design auth, consumer payments, onboarding, trip-start and failure/recovery states using the existing black/gold components and layout patterns. These extensions do not authorize an unrelated visual redesign. |

Removing Rove Pro does not remove earnings, payout setup, receipts or transparent driver compensation. The actual fare/fee/earnings formula remains an open business decision. Do not replace “100%” with an invented commission. Likewise, no recurring schedule implies institutional membership, guaranteed driver assignment, early arrival or an automatically booked return.

Tips, ratings and messaging exist in the references. Preserve their design reference, but their prior optional/unresolved implementation scope is unchanged by this approval. They must not prevent completing or viewing a paid ride. Messaging was subsequently authorized and is implemented under the assignment, retention-visibility and reporting policy in [Rider–driver messaging](64-trip-messaging.md). Unlimited post-trip contact is not implied by the mockups.

## Visual and component contract

- Preserve near-black backgrounds, slightly lighter charcoal cards/sheets, warm off-white primary text and muted secondary text. Use the existing warm-gold accent/gradient for primary actions and selected states.
- Preserve Manrope typography, clear large headings, rounded search fields/cards, outlined secondary actions, pill-shaped bottom navigation, simple line icons and restrained separators. Use the driver's map-plus-bottom-sheet composition for offers and active trips.
- Preserve the rider Home greeting/search hierarchy and its gold route illustration style. Replace medical-only shortcuts with the rider's own saved places, such as Home or Work. Medical destinations remain possible ordinary destinations, not default payer eligibility.
- With scheduling off, remove schedule chips, standing-ride promotions and scheduled-only summaries. Close the layout gaps. A proposed replacement for the gold Home card is “Your next stop starts here” with “Choose a destination,” leading to the same booking flow, without discounts or service guarantees.
- Rider navigation retains Ride, My rides, Messages and Account in the same visual family. My rides retains personal history with scheduling off. Driver navigation uses Drive, Trips, Earnings, Messages and Account; the existing Schedule tab becomes Trips/history with optional Upcoming content when eligible.
- Native safe areas, keyboard avoidance, scrolling, dynamic text and accessibility take priority over copying fixed screenshot dimensions. Use minimum 48×48 logical-unit touch areas as the proposed shared target and visible labels for icon actions. Verify text contrast, screen readers and large-font layouts before accepting tokens.
- Loading, errors and disabled states reuse existing surfaces. Gold means primary action, not every status. Danger/error requires text/icon distinction. Honor reduced motion; operational states and countdowns are never decorative animations or fabricated progress.

Implement reusable native primitives such as Screen, Card, RouteSummary, GoldButton, SecondaryButton, StatusBanner, BottomSheet, MoneySummary, LabeledField and EmptyState only where concrete usage warrants them. Keep feature orchestration separate from presentation, and server policy out of UI components.

## Rider screen mapping

| Existing Figma frame | Decision |
| --- | --- |
| `2:12` Home | Preserve greeting/search/cards/nav; remove scheduled-only sections when off and default medical-coverage assumptions. |
| `4:20` Book a ride | Preserve route fields and place suggestions; default Pick up now; expose scheduling only through capabilities. |
| `4:79` Pickup date & time; `5:20` Repeat; `17:73` scheduled booking | Flagged references. Weekly exists visually; monthly needs the extension specified below. |
| `5:89` Confirm ride | Convert to consumer quote review with payment method, applicable fees/terms and quote expiry; no default coverage or promised early/return service. |
| `5:127` Finding your ride | Real searching state with cancel, then explicit matched/no-driver outcomes. |
| `6:20` Tracking | Distinguish driver approaching, driver arrived, rider onboard and destination arrival. Rider actions cannot assert driver milestones. |
| `6:107` Arrived + tip; `7:20` Tip confirmed | Completion and truthful payment result first; tips/ratings only when implemented and optional. |
| `7:45` My rides; `8:20` Ride details | History, payment state and receipt remain available without scheduling. Existing commitments remain accessible after flags turn off. |
| `8:146` Messages; `9:20` Message thread | Preserve reference style; scope communication to authorized rides and approved contact windows. |
| `9:67` Account | Consumer payment methods, profile, saved places, privacy/account deletion and help; coverage not a default section. |

## Proposed rider additions

| Screen/state | Composition and copy direction | Actions and behavior |
| --- | --- | --- |
| Welcome / sign in | Rove mark, short heading, charcoal form/card, gold Continue | Final login method follows managed-auth decision. Verify/recovery variants reuse fields; no custom OTP/password engine. |
| Verification / recovery | Clear destination hint, validation text, resend/retry status | Provider-supported verification, expired/invalid attempt, rate-limit and recovery states; no success before server confirmation. |
| Location permission | Short explanation and matching gold action | Allow location or enter pickup manually. Denial does not block manual booking. |
| Quote review | Route summary at top; available service choices; fare breakdown and selected payment card; bottom gold “Request ride” | Price/terms visible before request. Changed/expired quote requires review and fresh confirmation; preserve route input. |
| Payment methods / add method | Existing account-row/card patterns; masked details; gold Add payment method | Use processor-supported secure collection, never raw card storage. Loading, failure and additional authentication return to the same quote. |
| No driver found | Existing finding-ride sheet becomes an honest empty state | “No drivers available right now,” then Try again / Change pickup / Back home. Retry revalidates quote and payment, with no automatic second charge. |
| Cancel confirmation | Bottom sheet with plain-language consequence and actual applicable fee | Keep ride / Confirm cancellation. Hide stale confirmation and refresh if state changes; backend decides admissibility. |
| Payment pending / failed | Completion still says trip completed; separate settlement banner and masked method | Update method or approved retry through the same financial operation. Pending is not failure; do not issue a duplicate charge. |
| Tracking unavailable | Map retains last known sample with timestamp and explicit stale/offline banner | Support/contact remains reachable. No fake moving driver marker or invented ETA. |
| Help / account deletion | Existing grouped account rows plus readable detail page | Trip-linked help, lost-item/safety issue entry, deletion request and clear outstanding-trip/payment handling. No promise of immediate erasure of required records. |

Rider happy path: Home → pickup/destination → quote/payment review → request acknowledged → searching → matched/approaching → arrived → in trip → completed → payment status/receipt. No “I've arrived” rider control may stand in for driver arrival, pickup or completion; any rider location message must be clearly a message only.

## Driver screen mapping and additions

| Existing frame | Required adaptation |
| --- | --- |
| `1:12` Offline; `1:62` Online waiting | Keep status and earnings hierarchy; remove Pro copy and flagged schedule cards. Going online requires current eligibility, permission and server acknowledgement. |
| `2:2` Ride request | Keep map, sheet, gold estimated earnings, timing and accept/decline buttons; apply the restricted offer payload below. No standing-ride badge while scheduling is off. |
| `2:108` Heading to pickup | Exact authorized pickup available after acceptance; retain navigation handoff and arrival action. |
| New Arrived / start trip | Extend the same sheet with “Waiting at pickup,” rider identity appropriate to the assignment, gold “Start trip,” and issue/no-show support. No-show needs policy/evidence; never infer pickup from GPS. |
| `2:186` Trip in progress | Show authorized destination, navigation handoff, active state and Complete trip; online/offline or logout transitions cannot silently abandon active work. |
| `2:262` Trip complete | Actual earned amount and settlement/payout status; remove 0% commission promise. No fabricated tip, fee or payout date. |
| `3:2` Schedule; `3:74` Scheduled ride details | Flagged Upcoming views under Trips. Completed-trip history remains available with flags off. |
| `3:162` Earnings; `4:106` Account | Preserve charts/rows; remove Pro subscription and “you keep 100%.” Use server amounts and chosen payout schedule; retain payout setup and credentials. |
| `4:2` Messages; `4:51` Message thread | Assignment-scoped communication and cleanup on revoked access; availability follows the communication feature's readiness. |

New driver onboarding: Sign in → basic profile → vehicle and supported capability details → secure document submission → review status → payout setup where required → permission explanation → eligible to go online. Use the existing account-list, card and gold-button patterns. Show per-document pending/approved/rejected/expired state, safe rejection guidance and resubmit. A front-end checkmark cannot approve a driver; the backend/staff workflow decides eligibility.

Additional state designs:

- Offer expired/unavailable: replace countdown/action with “This request is no longer available”; return to waiting after acknowledgement. On Accept show “Confirming…” and disable duplicate taps until backend result. Never keep the offer locally accepted after a conflict.
- Permission/eligibility blocked: clear banner and the exact next step (open settings, update document or contact support). Disable Go online without disguising the reason. Preserve active-trip support during eligibility changes.
- Offline/pending sync: visible banner and pending milestone indicator; original command id survives retry. Do not queue offer acceptance or going online while offline. Reconnect fetches authoritative ride/assignment before enabling actions.
- Start/complete trip: deliberate tap/confirmation, clear assigned ride context, pending acknowledgement and conflict recovery. No extra distracting form while driving.
- Issue reporting: accessible from pickup and active trip; distinguish inability to find rider, vehicle issue and safety incident. Active onboard interruption goes to safe staff escalation rather than ordinary rematching.

## Driver offer data boundary

| Stage | Allowed display/data | Excluded |
| --- | --- | --- |
| Before acceptance | Offer id/expiry, estimated driver earnings with terms, coarse pickup/drop-off areas, estimated pickup/trip time/distance, necessary verified service capability such as wheelchair-accessible vehicle | Rider name/avatar/contact/rating/history, exact address/unit/coordinates, street-level route revealing endpoints, Medicaid/NEMT/payer labels, diagnoses and private rider notes |
| After committed acceptance | Assignment-scoped identity/contact channel, exact route and minimum necessary assistance instructions for this ride | Unrelated rider history, payment instrument details, medical funding/diagnosis information without an explicitly approved operational need |
| After revocation/end | Only role-authorized history/earnings/contact scope under retention policy | Continuing live location stream or cached access to a revoked assignment |

This is an API allowlist, not merely visual masking. Use separate offer and assignment DTOs; exclude sensitive values from push payloads, logs, analytics, map assets, error objects and caches. Broad-area maps must not reveal exact endpoints through markers, polyline geometry, deep links or geocoding results. Validate service capability server-side without exposing diagnoses. Test serialization as well as visible UI.

## Scheduling designs retained behind flags

When disabled, hide Schedule ahead, repeat/week/month selectors, standing-ride promos, recurring badges and new scheduled booking actions on both apps. Direct links must show “Scheduling isn't available right now” with Back to rides; reject forbidden mutations in the API. Do not erase existing history or commitments.

When enabled, reuse the supplied date/time and Repeat screens. Add a Monthly choice alongside One-time and Weekly using the same segmented/list controls. Proposed initial monthly rule: selected day-of-month in the pickup timezone, with explicit “Skip months without this date” explanation and a preview of the next occurrences. Never silently move a 31st booking to another date. The chosen policy, DST handling, finite generation horizon and funding rules must be implemented and tested before monthly rollout.

Show occurrence dates, per-ride quote/payment terms, edit-one versus edit-future scope, cancellation scope and actual assignment state. Do not say a driver is guaranteed or a return is included. A return is a separate explicit leg and is outside these scheduling flags until separately approved. See [scheduling flags](17-scheduling-feature-flags.md) for rollback obligations.

## Acceptance and handoff

For every implementation PR, list Figma file/node references, approved deviations, new screen identifiers, backend states and screenshot evidence on iOS and Android. Compare at the reference size and a smaller device with large text. Test enabled/disabled scheduling, missing data, slow/offline networks, long addresses, reduced motion and screen readers.

Verify the core consumer journey with no sponsor configuration; no subscription or 100%-fare claim in UI; redacted offer responses before acceptance; no-driver/payment failure recovery; driver arrival → start → complete order; and existing-trip access after flag rollback. Screenshots are appearance evidence, not proof of authorization or payment correctness. Source screenshots/assets remain references, not production code or copied example personal data.

## Design access verification — September 7, 2026

The Figma connector successfully returned full design context and screenshots for rider Home (`2:12`) and driver Online/waiting (`1:62`). These frames specify black `#000000` backgrounds, `#0A0A0A` sheets/fields, `#0F0F0F` cards, gold `#D6B26D`, text `#F4F0E8`, muted text `#8B8B8B`, and Manrope typography. The rider promo uses a multistop gold gradient. Rider navigation is a floating pill; driver waiting uses a full map with a top status pill and bottom sheet. These are frame values, not a completed shared-variable audit. Implementation alignment remains outstanding; all approved consumer/scheduling/privacy overrides above still apply.

## Driver Drive screen adaptation

The Drive header follows the current driver Offline frame `1:12`: compact Manrope wordmark,
account-initial badge, wrapping greeting, availability pill, rounded summary cards and pill-shaped
availability action. The shared Driver navigation replaces the earlier stack of full-width navigation
buttons. Account, Trips and Earnings remain reachable through labeled touch targets; the badge also
opens Account. The Online reference is `1:62`; the waiting state now places a native location map
under a status pill, above a rounded scrolling sheet. The sheet retains actual earnings, connection
errors and the offline action. The map uses an accurate local sample for its initial region and the
native location indicator thereafter; synthetic previews have an explicitly labeled test marker.
Web previews explain that maps require the native apps. Missing keys or location show an honest
unavailable state. Background heartbeats remain owned by the tracking provider, not the map.

The map and sheet use bounded responsive heights so recovery controls remain scrollable, rather
than copying the reference's fixed 844-pixel positioning. Platform SDK keys are configured locally. Driver accepted-trip Google tiles were verified on
iOS and Android, and browser online/offline navigation passed. The waiting-map surface also rendered Google tiles and the local test marker on both
platforms. Full visual parity, large-text layouts and real-device tracking remain separate checks.

Dashboard amounts come from the existing earnings API, with TODAY · UTC and ALL TIME explicitly
representing recorded earnings. They are not paid-out balances. Requests refresh only while focused
and foregrounded; failed reads show unavailable values, never fabricated zeroes. The current API does
not expose trustworthy online-duration or completed-trip aggregates for this dashboard, so the
reference's sample hours/counts are omitted. No scheduled card, Rove Pro subscription, 100%-fare
promise or medical rider identity is reintroduced. Active-trip recovery, eligibility and location
permissions continue using the existing server-backed controls.

The online waiting map extends behind the system status bar to the top edge. Only its status
pill is offset by the top safe-area inset; the lower sheet retains its position and bottom
navigation remains protected. This layout was visually checked on iOS and Android simulators.

Driver navigation icons use transparent PNG renders of the original Figma `4:281` SVG exports,
retained alongside them in assets/navigation. Icon tint follows the selected route, matching the
label and accessibility selection. Native iOS and Android screenshots verified the Drive selection
and transparent backgrounds; the earlier opaque raster exports must not be restored.

## Driver offer sheet adaptation

Driver Ride request (`2:2`) now uses the native driver-location map above a rounded scrolling
sheet, compact estimated earnings and travel summary, response countdown, and pill-shaped actions.
The map only receives the driver's own location; it never receives offer endpoint coordinates or
route geometry. Pickup/drop-off text comes from the strict broad-area offer contract. The original
Figma route connector SVG is retained in assets/offers with its transparent PNG render. Rider
identity, rating/history, medical funding, standing-ride labels and 100%-fare claims remain excluded.
Standard or accessible service is shown from the actual offer. Shared Rove buttons retain their
subtle gold gradient and restrained translucent treatment; full visual/motion acceptance remains outstanding.

The original acceptance journal and lost-response recovery remain intact. Browser checks cover a
completed synthetic trip with lost acceptance response, long area labels at 320-pixel width,
expiry disabling both responses, and return navigation. Native simulator checks cover the offer
sheet and absence of the synthetic exact pickup address; they do not establish real-device GPS,
live offers or payment settlement. The layout preserves scrolling for larger text and small screens.

## Driver active-trip surface

Heading to pickup (`2:108`) and Trip in progress (`2:186`) now use a top-edge native map,
server-state status pill, and rounded scrolling detail sheet. A persistent bottom action area
keeps arrival/start/completion reachable without panning the map or scrolling through route details.
Confirmation content can scroll on smaller screens. The existing fresh-state, conflict and lost-response
checks still control mutations. Ended trips return to ordinary history/earnings layout without precise
endpoints or rider identity, using the server's redacted response.

Maps show authorized endpoint markers with a manual reframe control. No fabricated turn-by-turn
route, ETA, remaining distance, rider notes, contact service or progress percentage is introduced.
The new optional shared-map fill layout leaves rider inline maps unchanged. Real route geometry,
compact rider-contact presentation and subtle gold gradients are now implemented; full Figma/motion acceptance remains outstanding.

Android native verification exercised accepted-trip map display and a confirmed pickup transition.
iOS verification exercised arrival, start and completion, with exact addresses and rider identity
absent after completion. Browser verification covers navigation handoff, unavailable reads, concurrent
milestone updates, lost acceptance recovery and completion through synthetic payment settlement.

## Rider tracking driver summary

Rider Tracking (`6:20`, driver card `6:70`) now uses the original generic avatar export,
compact driver typography, and charcoal rounded card. It appears directly after the inline map.
The name and status come from the assigned ride; Pickup/Ride stages advance only on committed
trip state and disappear with the driver card when the ride ends. Interrupted trips display their
attention state without a normal progress indicator. The avatar is decorative, not a driver photo.

No mock arrival time, vehicle plate, call action, progress percentage or rider-controlled arrival
is introduced. Those require their own provider/contract support. Route geometry and remaining tracking visual parity are still outstanding. Browser verification
covers pickup-to-onboard progression and removal after completion; iOS and Android simulator
checks cover the accepted-ride card and original avatar rendering.

The active rider tracking header follows `6:22`–`6:36`, with original back/account/status assets,
48-point touch targets, Manrope wordmark and state-derived status pill. Active trips hide the
extra native stack header so Screen owns the top safe area once; the heading uses the reference's
23/29 typography and 16-point content gaps. Back opens personal ride history, Account opens the
existing account route. Terminal/loading states retain the ordinary native header. iOS and Android
screenshots and header/card assertions passed, alongside the full browser trip lifecycle. The
inline map retains its existing accessibility and reframe controls; its detailed layout remains
an adaptation rather than pixel-identical parity with Figma's decorative map.

The rider driver card now displays the effective vehicle's make, model, color and plate, matching
Figma's identification row with actual assignment data. The ride API projects a strict `RideVehicle`
allowlist from the approved vehicle record; pending submissions, document references and review
notes are not exposed. Invalid or incomplete legacy records omit vehicle identification and the
card says it is unavailable. Driver and vehicle identity remain limited to the owning rider's active
assignment and are absent after termination/completion. No example plate, registration region or
vehicle year is invented. The existing vehicle-review service prevents changing the effective
vehicle during an active assignment.

## Rider booking route panel

Rider Book a ride (`4:20`) uses the reference's centered heading, close control, Pick up now
pill, joined pickup/destination panel and place-result rows. The exact close, clock, endpoint
and place-pin exports are retained under `apps/rider/assets/booking` with transparent native
PNG renders. Colors use the subsequently approved shared gold/glass tokens. Search results
show provider-supplied labels and areas; no sample medical destinations or current-location
claim is substituted for an address the rider selected.

Either endpoint can be entered first. Editing one keeps the other selected endpoint, and
keyboard Search uses the same explicit request path as the Search places button. Saved-place
management, service selection, quote review and lost-request recovery remain available.
Scheduling and additional stops are not exposed without implemented, enabled capabilities.
The screen scrolls and wraps selected addresses rather than copying fixed Figma heights.

The initial panel was visually checked on iOS and Android simulators. Booking E2E checks
cover cancellation, completed synthetic trips, lost responses, actual search expiry/retry,
and saved-place recovery. These checks do not establish physical-device keyboard or live
Google Places acceptance.

## Rider ended-trip details and rebooking

Ended rides use the Ride details (`8:20`) header, recorded request time/date, state badge and
rounded route card. Back and route-connector icons are exact exports under
`apps/rider/assets/ride-details`. The date is explicitly labeled Requested; it is not an
invented pickup or completion time. The existing map shows authorized endpoints, not the
reference's decorative route or fabricated traveled distance. Driver identity remains hidden
according to the existing ended-assignment contract. Unsupported ratings, certification,
coverage discounts, tip amounts and recurring schedules are not rendered as sample data.

Completed and cancelled rides with available endpoints expose Book this trip again. This
opens the existing route-copy flow; a new quote and explicit confirmation are still required.
Read errors and pending-operation recovery disable this action. Receipt access remains
separate and displays recorded payment values. Browser lifecycle checks verify rebooking
from cancellation and completion without automatically submitting another ride. iOS and
Android cold-launch checks verify the header/route card and the correction of a stray text
node in the shared native map caption.

The rider tracking contact action is grouped inside the assigned-driver card, with the committed
Pickup/Ride/Arrive stage indicator below the card as in `6:20`. Message driver opens the existing
authorized conversation instead of rendering the reference's unsupported telephone action.
The contact component is keyed by ride so pending lookup state cannot transfer between trips.
The 320-pixel browser contact layout and two-way persisted messaging flow passed, along with
the completed-trip lifecycle and identity removal. The card grouping and opening its authorized conversation also passed on iOS and Android
simulators using a local synthetic assignment; physical-device acceptance remains separate.

The rider confirmation (`5:89`) now inherits the approved shared subtle gold button treatment
instead of overriding it with the original gradient. Quote validity is displayed from the
server expiry timestamp. Expiry changes the action to Review updated fare and preserves the
route for a fresh quote; no refresh automatically creates a ride. Foreground return rechecks
expiry, while the existing submit-time and server checks remain authoritative.

The founder requested a subtle gold gradient after reviewing the flat confirmation button.
Shared primary buttons now add a low-contrast diagonal gold tint over their translucent base
on web, iOS and Android. Secondary and danger variants retain their existing fills. The effect
uses no bright highlight band or additional raised shadow.

## Rider matching state

Rider Finding your ride (`5:127`) uses the exact exported rings and car, centered matching
copy, and a compact top-right cancellation action. Ride details expand on demand to retain
access to the actual route, fare and payment state. The matching presentation applies only
to searching rides with authorized payment (or local synthetic mode); payment confirmation
retains its separate flow. Failed reads replace matching copy with a reconnecting state and
invalidate cancellation confirmation as before. No nearby-driver count, ETA or progress is
fabricated. The rings use a gentle 3.6-second scale/opacity pulse; the car and text stay still.
The pulse is disabled for Reduce Motion, reconnecting, backgrounded apps and unfocused screens.

The layout was visually verified on iOS and Android simulators and at 320 pixels in the
browser. Browser checks passed for expanded details, cancellation, failed-read and stale
version recovery, and a complete synthetic rider/driver trip. Physical-device acceptance
remains separate.

The rider navigation now uses the approved driver-style translucent black fill, fine border
and subtle shadow. Ride, My rides and Account use the shared floating footer layout;
Messages already did. Safe-area placement and measured footer clearance keep final content
scrollable above the bar. The wrapper lets touches outside the pill reach underlying content.
Rider type/lint checks passed, with native previews inspected on iOS and Android.

## Rider live driver location

The assigned rider receives fresh driver coordinates while matched, approaching pickup,
arrived, and in progress (also during an interrupted active trip). The native rider map
now follows those coordinates automatically. Panning or Show full trip stops camera
following; Follow driver restores it. The driver marker is drawn above endpoint markers.
Locations are last-reported GPS samples, not interpolated or invented vehicle movement.

The driver background task requests high-accuracy updates around every three seconds.
Authenticated WebSocket invalidations prompt authorized rider reads while connected;
five-second polling is a fallback when the realtime transport is unavailable. OS scheduling
and connectivity can delay GPS samples and delivery. Samples expire after sixty seconds, failed reads remove the marker, and ending the
assignment revokes location access. Only the assigned rider can read these coordinates.
Server tests cover moving samples during pickup and travel, expiry and unauthorized readers.
The browser lifecycle test now uploads changing coordinates in both phases and verifies the
rider receives them. iOS and Android simulator maps were inspected before and after a moved
sample during an in-progress synthetic trip. Physical-device background/locked-screen GPS
acceptance is still required before production release.

The ring pulse was verified by comparing native iOS and Android frames: changed pixels were
confined to the ring area. Rider types/lint and the cancellation/recovery browser check passed.

## Driver coverage radius

Account → Coverage radius lets drivers save a whole-number pickup radius of 1–100 miles,
defaulting to 25 miles. This replaces the previous fixed 25-kilometer matching filter.
Distances are straight-line distances from the driver's latest eligible location. Existing
pickup-time, service, location freshness and eligibility limits remain in force. Radius
changes apply to newly created offers; already-issued offers and accepted trips remain intact.
The saved radius is rechecked under the driver lock after routing, so changing it during a
provider calculation cannot create a new out-of-radius offer.

`PUT /v1/drivers/me/coverage` accepts `{ radiusMiles }` and an Idempotency-Key. Only the
signed-in driver can change their preference. The driver profile exposes coverageRadiusMiles;
older server responses default to 25 in the client contract. Migration 0029 adds the bounded
column with a default for existing accounts. It was applied to provider staging before code
publication. The earlier separate staging database was not changed.

Matching tests verify miles conversion, persisted narrowing/widening, validation, replay and
concurrent changes. The full repository tests passed. The browser settings flow verifies a
lost-save response and reuse of the same operation key; iOS and Android previews were checked.

## Real-time rider tracking

Rider location refresh is now driven by the shared authenticated WebSocket. Each committed
GPS update invalidates only the assigned rider's location view; the app immediately fetches
the latest coordinates through the authorized location endpoint. Location notifications carry
no coordinates or ride identifiers and do not refresh unrelated message lists. Ride/assignment
notifications also invalidate location access. A healthy location-capable connection disables
periodic polling; older servers or disconnected transports retain the five-second fallback.
Foreground reconnect catches up and local expiry still removes stale markers independently.
Driver GPS sampling and OS delivery remain separate from WebSocket transport timing.

Migration 0030 adds the targeted post-commit driver-location notification trigger. Socket
readiness checks both message and location trigger installation and advertises the location
capability. Tests passed for committed-only cross-instance delivery, participant isolation,
trip-end revocation, client fallback, the moving-location trip flow, messaging and the full
repository suite. Physical-device locked-screen GPS testing remains a release requirement.

### Rider completion and contextual support

Rider Figma `6:107` was retrieved on September 12, 2026. The completed-ride view now uses its centered 64-point outlined gold check badge, 22-point heading and destination label, followed by the existing recorded route and fare cards. The exact exported check asset is committed. Completion is shown only for the server's completed state; paid, review-required and updating payment states use distinct copy. The app does not invent trip duration, a driver identity after its visibility window, a covered fare, a return booking, rating or tip controls.

Completed/ended rides link to trip support and receipts link to payment support. The support screen verifies the requested ride with the account-authorized API before attaching its reference and selecting a category. It never submits a request automatically. A failed or unauthorized ride lookup offers retry or general support without attaching the unverified reference. The user's description remains required, and the reference plus description fit the existing request size limit.

### Driver trip support consistency

Driver trip details now include the existing outlined secondary Get help with this trip action. Both apps reuse the same verified-context support form and shared dark surfaces, typography and gold actions. The form requires the user's description and does not represent intake as a refund, trip change or staffed response.

## Rider ride-link recovery and compact layout — September 12

A signed-out ride link now shows a clear account recovery action without starting private ride reads. Incomplete links direct signed-in riders to My rides. The trip component is keyed by account and ride so a route or account change cannot reuse the previous screen state. A failed initial read no longer claims to be loading indefinitely and leaves an explicit history action available while foreground retries continue.

The signed-out recovery layout was visually inspected on the Android emulator with system font scale 2.0; heading, explanation and primary action were visible and wrapped without clipping. The original scale 1.0 was restored. On iOS, a Maestro check at accessibility-extra-extra-extra-large passed app launch, ride-link opening, scrolling to the recovery action and its visibility assertion; the simulator’s original large setting was restored. The debug warning overlay remains outside this product-layout acceptance. This is one Android accessibility layout check, not a full app or physical-device acceptance pass. At a 320×568 browser viewport, all rider navigation labels fit on one line with at least 48×48 touch targets and stayed inside the viewport; scrolling Home to its end exposed the last card above the floating bar. Browser checks also exercise recovery to account and My rides.

## Booking storage recovery

Reviewed rider Figma `4:20` design context on September 12: the existing booking header, route card and place-result hierarchy follow the reference, subject to the approved consumer/scheduling overrides above. This is a review of that frame, not full rider parity. When the saved-operation journal cannot be read, booking now offers Retry reading request, Contact support and Back home using shared controls. Retry only reads storage: an existing operation still requires explicit confirmation, and unreadable storage continues to block new booking. This fills the contract's failure/recovery requirement without adding a second booking or clearing an uncertain request.

## Driver offer storage recovery

The offer failure state now uses the same gold retry and secondary support/back controls as rider booking recovery. An unreadable journal blocks responses; retry reads storage only, and a saved acceptance requires explicit result confirmation. This implements the existing recovery-state extension without changing the normal offer layout or pre-acceptance privacy boundary. The 390×844 browser screenshot was inspected and recovery/expiry scenarios passed; physical-device acceptance remains open.

## Active-trip saved-request recovery

Rider tracking and driver active trips now share a dark recovery card with a gold read-only retry and secondary contextual support action. Trip reads continue while saved-operation storage is unavailable; cancellation and driver milestones remain blocked. Retrying invalidates the previous local confirmation. Empty storage restores deliberate trip controls, while a saved operation still requires Check previous action. No retry clears or submits that operation. This extends the approved failure-state design; it is not a change to normal tracking or assignment permissions.

## Existing deletion-request acknowledgement

The shared rider/driver account-deletion screen recognizes an existing open request created by this flow and shows Deletion request received with its reference instead of another send action. A successful submission is acknowledged even if the following history refresh fails. Recent requests and support responses remain visible; resolved history does not prevent a new deliberate request after reopening. This is request acknowledgement only: the account remains active and no trip, payment or retained record is changed by this screen.

## Signed-out deletion access recovery

Both account-deletion routes wait for session restoration, then offer signed-out or incomplete accounts a clear heading, explanation and the existing gold Continue to your account action. It returns to welcome/setup; users then open Request account deletion from Account. The authenticated request form and acknowledgement remain unchanged. Four focused browser scenarios and rider/driver iOS and Android debug smoke checks passed on September 12; inspected text and buttons fit the native layouts. This does not verify physical devices or actual account erasure.

## Lost notification-proof reset

The shared Trip notifications card now presents device management and an explicit reset confirmation when saved registration proof is lost. Confirmation explains that all listed notification devices must first be turned off, other phones stay signed in and this phone remains opted out after reset. Cancel performs no work; successful reset returns to Enable notifications. Existing gold/secondary controls and wrapping copy are retained. The real controls passed an isolated browser harness at 320 and 390 widths using Manrope; native recovery and physical-device acceptance remain open.

## Refund receipt extension

The rider receipt uses the existing Manrope, dark cards, gold amount typography and contextual support action for verified refund updates. It distinguishes unchecked history and each provider status while preserving captured/quoted amounts. This is a documented functional extension; full Figma parity and physical layout acceptance are not established.

## Driver earnings adjustments — September 12

The existing gold/charcoal earnings cards now distinguish gross trip earnings, signed adjustments and net earnings. Activity rows label refund/dispute deductions and reversals; date filters apply to the recorded date of each event. Daily charts remain gross and say so. Home metrics and completed-trip totals use net earnings when supplied. Older-server responses remain explicitly gross-only, with unavailable adjustment detail explained. No available-withdrawal or bank-payment claim is added. This extends the approved transparent-compensation requirement; it does not claim new Figma extraction or full screen parity. See [financial allocation and driver display](70-payment-loss-allocation.md).

## Driver account activity review — September 12

Driver Account `4:106` was reviewed through Figma design context. The profile, account rows and new three-card activity row reuse the existing shared surfaces, avatar, typography and user-approved floating navigation. Activity cards use 14px padding, 16px corners, 18px bold values and wrapping 10px labels; they may wrap into additional rows for accessibility instead of clipping fixed Figma widths.

The implementation shows factual completed-trip and accepted-offer totals plus registration month. The mockup's rating and percentage metrics are not populated with example values or presented as verified performance. Rating support and acceptance/completion metric definitions remain unresolved; this checkpoint is not full account-frame parity. Counts include retained records only, are independent of payout settlement, and refresh on screen focus or pull-down. Loading/failure states never fabricate zero totals.

## Durable deletion request presentation

Both account-deletion screens retain the existing shared black/charcoal confirmation layout and explicit consent action. They now use the durable account-deletion status rather than an open support ticket to show receipt and hide repeated submission. The status card explains that support resolution is not account/data erasure. Missing status blocks confirmation and offers refresh; lost-response retry retains its original command identity. Synthetic browser tests cover both roles, resolved support tickets, refresh failures and signed-out access. Native visual acceptance remains separate.

## Pending deletion withdrawal — September 12, 2026

Both consumer account-deletion screens reuse the existing charcoal cards and gold/secondary actions for withdrawal before closure. The action requires an explicit confirmation with a Keep deletion request alternative. The persisted withdrawn state allows a fresh explicit deletion request; a lost response retries the same action and reloads current status. This is an account recovery extension, not an erasure-completion screen. Closed account restoration is outside this flow.
