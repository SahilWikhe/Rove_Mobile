# Product scope and pilot assumptions

Status: proposed implementation baseline. Owner: product lead/founder. The source materials establish a care-transportation direction, not a signed pilot, final fare model, or legal operating approval.

## Product outcome

Make a recurring transportation plan visible and dependable for a rider, the people authorized to help them, and the operator responsible for delivering it. A successful booking is more than a database row: someone must cover the trip, the return must be addressed, and failures must reach a human who can act.

Use a scheduled, manually dispatched pilot as the first scope. Start with a small service area and approved drivers. Do not implement general on-demand matching, surge pricing, pooled routing, or automated insurance claims as prerequisites for the first ride.

## Actors and ownership

| Actor | Primary job | Boundaries |
| --- | --- | --- |
| Rider | Request, view, change, or cancel their rides | Cannot assign a driver, change a fare, or access another rider |
| Caregiver | Help a specifically authorized rider | Invitation or relationship alone does not grant all permissions |
| Driver | View assigned work, accept, navigate, report milestones | Cannot browse all riders, approve themselves, or set settlement values |
| Dispatcher | Schedule and assign rides for their organization | Scoped to the organization and service programs they operate |
| Facility coordinator | Arrange rides for enrolled riders | Restricted program membership; never unrestricted clinical or fleet access |
| Finance operator | Reconcile authorized funding and settlements | Does not need access to detailed GPS trails |
| Platform administrator | Manage organizations and exceptional support | Explicit privileged actions, MFA, audit, and limited access |

Initially, an organization is the operational/security tenant. A rider may participate in more than one organization, but membership and ride access are explicit per organization. Cross-organization dispatch and shared-fleet optimization are later capabilities. A user can hold multiple roles without receiving the union of those roles in every organization.

## Pilot journeys

### Scheduled outbound ride

1. An authenticated rider, delegated caregiver, or coordinator selects pickup, destination, desired arrival time, and supported assistance requirements.
2. The API checks enrollment, service area, contract rules, and time validity. It returns a request identifier and the true confirmation state.
3. An operator confirms coverage and assigns an eligible driver/vehicle. A request is not a promise of transport until coverage is confirmed.
4. The driver accepts, starts travel to pickup, confirms arrival, confirms pickup, and completes the leg.
5. Authorized viewers see server-confirmed state and location freshness. Operators can intervene when a milestone is late.

### Return ride

An outbound and a return are separate ride legs linked by a journey. Treatment completion cannot be assumed from a fixed duration. Support both scheduled return windows and a `ready_for_return` signal from an authorized rider/caregiver/coordinator. That signal changes readiness; it does not invent capacity or automatically confirm a driver.

Show whether the return is requested, covered, or still needs assignment. An outbound cancellation must explicitly resolve the linked return rather than silently deleting it. Once a person has been picked up, use an assisted exception process rather than allowing an ordinary cancel action to abandon the ride.

### Recurring rides

A recurring schedule is a template, not an infinite collection of confirmed rides. Generate a bounded horizon of legs, display which ones are covered, allow a single-date exception, and version changes to future occurrences. Every date needs its own coverage and financial authorization checks.

## Scope by stage

| Initial product | Before funded pilot | Later, when justified |
| --- | --- | --- |
| Sign-in and scoped roles | Verified operating/driver eligibility process | Automated credential-provider integration |
| Rider/caregiver and driver apps | Confirmed payer and payment workflow | General consumer marketplace |
| Operator scheduling and manual assignment | Recurring rides and return escalation | Multi-rider route optimization |
| Ride status and location freshness | Documented incident and support coverage | Embedded turn-by-turn navigation |
| Basic assistance capability matching | Privacy/vendor decisions and recovery drill | Employer/intern pooled programs |
| Synthetic demonstration data | Tested actual-device workflows | Automated payer/broker claims |

An operator may enter a ride for someone without a smartphone. Do not make device ownership or push-notification delivery a condition of receiving transport. Support staff must have a documented contact fallback.

## Business decisions that remain open

| Decision | Working assumption | Required resolution |
| --- | --- | --- |
| Launch corridor and facility | One NC pilot | Founder validates demand and coverage before pilot enrollment |
| Who pays | Institutional/sponsored first | Name the contracting payer and authorization requirements |
| Fare and driver subscription | Configurable; brief's $20 is a hypothesis | Approve rates, processor fees, refunds, and subscription applicability |
| Funding model | Contract may be prepaid or invoiced | Choose first model; never silently assume public buyers prepay |
| Driver relationship | Approved supply only | Determine employment/contractor model and operating requirements |
| Accessibility | Record requirements and match verified capabilities | Define actual fleet capabilities; unsupported trips require escalation |
| Return coverage | Scheduled window or explicit ready signal | Agree coverage hours and escalation responsibility |
| Caregiver delegation | Explicit scoped grants | Define verification, revocation, and representatives without rider self-consent |
| PHI and retention | Synthetic data until reviewed | Determine obligations and vendor contracts before real data |

Prices and eligibility rules belong in versioned policy/configuration, not hardcoded UI conditions. The app must never advertise zero commission, clinical support, wheelchair capacity, or guaranteed pickup unless the operating model supports the claim.

## Success measures

Define the event and denominator before reporting a metric. Track coverage rate, cancellations by initiator/reason, on-time pickup within the agreed window, return wait measured from readiness, completed legs, missed rides, and intervention time. Track driver earnings separately from platform revenue and payment fees. Segment operations by program and service window; do not combine unmatched definitions into one on-time percentage.

Product evidence comes from the internal brief and research memos listed in [sources](13-sources-and-assumptions.md). They contain different geographic priorities and unvalidated demand assumptions. This architecture does not resolve those commercial questions by choosing a software stack.
