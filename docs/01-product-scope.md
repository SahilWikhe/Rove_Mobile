# Product scope: consumer ride-hailing with an optional B2B product

Status: current user-directed scope. Owner: founder/product lead. This supersedes the earlier scheduled care-transport pilot as the primary product. Historical research remains useful for future institutional programs, but does not override this direction.

## Product outcome

Rove's main product works like a ride-hailing service: riders select a destination, see an estimate, request a ride, get matched with an available driver, track pickup and travel, and pay through the app. Drivers go online, receive offers, accept work, navigate, and see earnings. The first release can have a small service area and recruited driver supply while still providing this self-service, on-demand flow.

An institution-facing dashboard is a separate optional B2B product. It may let employers, clinics or other organizations arrange and fund rides for eligible people. A consumer must not need organization membership, a facility account, a sponsor, or a coordinator to use Rove.

## Repository and responsibility split

| Product | Repository | Owns |
| --- | --- | --- |
| Core Rove platform | `Rove_Mobile` | Rider and driver apps; identity mapping; matching; ride lifecycle; payments; shared API; core database/migrations; staff authorization and operational API use cases |
| Internal Rove dashboard | Separate repository, name TBD | Staff UI for approvals, support, safety and finance; staff session/API proxy |
| Institutional add-on | Separate repository, name TBD | Customer dashboard, organization-facing workflows, reports and a thin session/API proxy if needed |
| Marketing website | Existing `Rove` repository | Public marketing website |

Keep one authoritative backend for rides, driver availability, settlement and permissions. Splitting each dashboard into its own repository is useful for independent ownership and releases; duplicating the ride engine or database would create conflicting truth. See [B2B boundary](14-b2b-product-boundary.md).

## Actors

| Actor | Core behavior | Access boundary |
| --- | --- | --- |
| Consumer rider | Quote, request, follow, cancel under policy, pay, review receipt | Own rides/payment methods; authorized sharing only |
| Driver | Go online/offline, accept/decline offers, complete trips, view earnings | Own availability/earnings; limited offer data and accepted-trip details |
| Rove support/dispatcher | Handle incidents, failed matching, reassignment and disputes | Explicit staff permissions and audited intervention |
| Rove safety/eligibility staff | Review drivers, vehicles and incidents | Privileged scopes; separate from institutional customer roles |
| Rove finance staff | Reconcile charges, refunds and driver payables | Financial access without unnecessary location trails |
| Institutional coordinator (add-on) | Book/manage eligible sponsored rides | Only explicitly organization-associated rides/programs |
| Institution administrator (add-on) | Manage members, budgets and organization roles | Cannot become Rove staff or browse consumer trips |
| Caregiver/delegate (optional extension) | Help a rider under an explicit grant | Relationship-specific permissions, independent of organization membership |

Rove internal operations are required to run a transport service. They are not the optional B2B dashboard. Build a minimal staff console in the separate internal-dashboard repository. Its permissions, operational mutations and audit records remain in this repository’s backend. Internal tools must remain available when the institutional product is disabled. This is three product repos plus the website; see [repository boundaries](15-repository-boundaries.md).

## Initial consumer journey

1. Rider signs in, selects pickup/destination and an offered service type, and sees availability and a time-bounded quote.
2. Backend validates service coverage, quote, rider/payment eligibility and duplicate-request rules. It creates a request in `searching`, with no promise that a driver exists.
3. Matching selects eligible online drivers using fresh availability/location and a bounded geographic/ETA search. The first implementation uses sequential time-limited offers; concurrent fanout is a later optimization.
4. A driver accepts an unexpired offer. The backend atomically claims the ride and driver so no other rider or offer can win the same capacity.
5. Rider sees the accepted driver, vehicle and pickup estimate. Driver navigates, confirms arrival, pickup and completion.
6. Backend calculates the fare under the accepted pricing policy, settles payment once, records driver earnings and issues a receipt. Financial failure is tracked separately from physical trip completion.

There must be visible states for no driver found, declined/expired offers, quote changes, cancellation, unavailable payment method, stale location and pending synchronization. Staff assist with exceptions; manual assignment is not the normal consumer booking path.

## MVP and later scope

| Required for initial ride-hailing release | Optional follow-up | Internal Rove dashboard | Separate repository, name TBD | Staff UI for approvals, support, safety and finance; staff session/API proxy |
| Institutional add-on |
| --- | --- | --- |
| Rider/driver authentication and profiles | Scheduled rides | Organization onboarding/roles |
| Driver approval, online availability and vehicle capability | Recurring rides | Sponsor budgets and policy controls |
| Pickup/destination, quote and payment method | Caregiver/delegated booking | Coordinator booking and guest riders |
| Automated matching and acceptance timeout | Return planning | Organization-scoped reporting/invoicing |
| Live trip status and location freshness | Promotions, tips and ratings as prioritized | Contract-specific care transportation |
| Cancellation/no-driver recovery | Advanced optimization or pooled rides | Employer and facility programs |
| Ride completion, receipts and driver earnings | Embedded navigation | Payer/broker integrations only if approved |
| Essential Rove support/safety/finance operations | Additional markets/service types | Separate product rollout |

Uber/Lyft-style operation describes the core interaction, not a requirement to copy every incumbent feature. Surge pricing, pooling and all vehicle classes are not automatic MVP requirements. Define initial pricing and service rules explicitly.

## Business decisions still needed

| Decision | Baseline | Resolution before affected release |
| --- | --- | --- |
| Launch area and hours | Small controlled consumer service area | Confirm supply, support hours and local operating requirements |
| Consumer payment | Rider pays for their own rides | Choose provider/charge model, authorization/capture timing and disputes |
| Fare policy | Versioned server-owned pricing, quote expiry | Choose upfront/final fare calculation, changes, minimums and cancellation fees |
| Driver earnings | Transparent configurable policy | Confirm commission/subscription, fees and payout timing; the old $20 hypothesis is not locked |
| Driver relationship and eligibility | Only verified drivers go online/accept | Resolve legal, insurance, vehicle and onboarding requirements |
| Dispatch policy | Sequential timed offers, bounded search | Set offer expiry, search deadline, radius/ETA ranking and reassignment rules |
| Safety/accessibility | Verified capabilities and staffed escalation | Define supported services, safety features and accessibility procedures |
| B2B packaging | Optional separate product | Name/pricing/roadmap and organization funding model later |

## Optional scheduled and care features

Future schedules generate bounded occurrences and explicit coverage states. A return is a separate leg; no automatic promise that a driver waits while someone attends an appointment. Caregiver access requires a grant. Healthcare programs need an additional data/operational review before enabling them. These are extension requirements, not prerequisites for a consumer to request a ride.

## Acceptance and measurement

The core acceptance test runs without any institution or sponsored program configured. A rider can book, an online driver can be matched, a trip completes and payment/earnings reconcile. Disabling the B2B frontend or organization entitlements must not break unrelated consumer rides.

Measure quote-to-request conversion, match rate, time to match, driver acceptance, cancellation by actor/stage, pickup ETA error, trip completion, payment success, driver utilization and support incidents. Define denominators and event timestamps before dashboards. Add sponsor/return metrics only for the optional programs that use them.
