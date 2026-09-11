# Mobile design contract and approved Figma changes

Status: founder-approved direction recorded September 7, 2026; detailed screen extensions below are proposed implementation specifications. No application or Figma frames were changed by this document. Follow this contract together with [mobile architecture](05-mobile-apps.md), [scope](01-product-scope.md) and [feature flags](17-scheduling-feature-flags.md).

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

Tips, ratings and messaging exist in the references. Preserve their design reference, but their prior optional/unresolved implementation scope is unchanged by this approval. They must not prevent completing or viewing a paid ride. A messaging release needs its own authorization, retention and abuse/contact policy; unlimited post-trip contact is not implied by the mockups.

## Visual and component contract

- Preserve near-black backgrounds, slightly lighter charcoal cards/sheets, warm off-white primary text and muted secondary text. Use the existing warm-gold accent/gradient for primary actions and selected states.
- Preserve Manrope typography, clear large headings, rounded search fields/cards, outlined secondary actions, pill-shaped bottom navigation, simple line icons and restrained separators. Use the driver's map-plus-bottom-sheet composition for offers and active trips.
- Preserve the rider Home greeting/search hierarchy and its gold route illustration style. Replace medical-only shortcuts with the rider's own saved places, such as Home or Work. Medical destinations remain possible ordinary destinations, not default payer eligibility.
- With scheduling off, remove schedule chips, standing-ride promotions and scheduled-only summaries. Close the layout gaps. A proposed replacement for the gold Home card is “Your next stop starts here” with “Choose a destination,” leading to the same booking flow, without discounts or service guarantees.
- Rider navigation retains Ride, My rides, Messages (when implemented) and Account in the same visual family. My rides retains personal history with scheduling off. Driver navigation uses Drive, Trips, Earnings, Messages (when implemented) and Account; the existing Schedule tab becomes Trips/history with optional Upcoming content when eligible.
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
