# Operations, reliability, recovery, and costs

Status: proposed operating requirements. Targets below are planning targets to validate under pilot conditions, not measured achievements or contractual guarantees.

## Initial reliability targets

| Area | Proposed target / measurement |
| --- | --- |
| Core API availability | 99.9% monthly for correctly authorized core requests, with dependency-caused failures visible |
| Core request latency | p95 under 1 second for ordinary reads/mutations at pilot load, excluding explicitly asynchronous work |
| Location freshness | Show sample age; current rider pin expires within 60 seconds; requested three-second GPS is not guaranteed delivery |
| Outbox delay | Healthy queue oldest-due age below 60 seconds; investigate sustained increase |
| Matching deadlines | Offer delivery/executor latency must be well below the chosen offer TTL; measure before setting a launch target |
| Matching health | Time-to-match, no-driver rate, stale availability, acceptance races and rematch rate by market |
| Return coverage (extension) | Alert against contract/service windows when scheduled/care programs are enabled |
| Recovery point | Proposed database RPO <= 15 minutes, dependent on purchased retention/recovery capabilities |
| Recovery time | Proposed RTO <= 2 hours, demonstrated by a timed recovery exercise |

Measure cold-start and database-resume behavior as well as warmed requests. The generic 60-second outbox target does not apply to short matching deadlines: prioritize/time matching work separately and benchmark executor delay. Reassess sleeping compute before live ride-hailing; delayed offer delivery can destroy a match even when the API is healthy.

## Observability

Capture structured request/job logs with correlation ids and safe error codes. Track request rate/error/latency, DB connection pressure/query latency, outbox backlog/dead letters, assignment conflicts, overdue uncovered rides, location freshness, notification receipt failures and unreconciled payment intents. Separate operational service failures from infrastructure failures.

Use pseudonymous/internal references with a reviewed telemetry policy. Do not send addresses, raw GPS, contact data or treatment details to third-party analytics by default. Product metrics belong in purpose-built events with documented definitions, not full request logging.

Alerts have an owner, severity, threshold and runbook. Immediate response is needed for active riders without safe coverage, widespread authorization faults, money duplication or suspected data exposure. Less urgent queue/cost degradation can use a scheduled support queue. The founder must establish actual support coverage for offered ride hours; an alert to an unattended inbox is not escalation.

## Runbook: API or database outage

1. Confirm impact by environment, deployment and affected routes; inspect safe logs and provider status.
2. Pause new confirmations if capacity/state cannot be verified; display a clear service message.
3. Dispatch staff use the approved minimal contingency manifest/contact procedure for rides already in service. Access and storage of that manifest follow the privacy policy.
4. Identify last good code/schema combination. Roll back code only if schema-compatible; otherwise repair forward.
5. After recovery, reconcile queued commands, ride milestones and outbox intents before replaying external effects.
6. Record timeline, impact and corrective tests. Do not infer that silence from a driver's phone means the trip failed or succeeded.

## Runbook: failed matching or driver withdrawal

Inspect online supply, heartbeat freshness, market/service eligibility, search/offer deadlines and worker backlog. Exhausted search must stop, inform the rider and release the payment hold under policy. Do not extend an expired quote or accept a late offer to make metrics look better. Before pickup, a withdrawal can trigger bounded rematching with clear rider status and old-session revocation. After pickup, use human incident handling. Record actor/reason and financial consequences separately.

## Runbook: delayed return or missing driver (scheduled extension)

Check authoritative readiness, last driver contact and assignment validity. Contact the responsible operator/driver through approved channels. Find eligible replacement capacity and record reassignment with a reason. If a rider is already onboard, use the incident process and human coordination; ordinary cancellation is not a safe resolution. Follow the organization's emergency escalation policy when circumstances require it.

## Runbook: payment/provider uncertainty

Stop automatic retries that could move money twice. Find the stable business operation/provider id, inspect verified receipts and provider status, reconcile with ledger entries and create a corrective action if needed. Reverse/adjust through new entries. Never edit a balance or mark an unknown transfer successful just to clear a dashboard alert.

## Runbook: credential or data exposure

Restrict affected access, revoke/rotate credentials, preserve appropriately restricted evidence, determine impacted resources and involve the designated security/privacy owner. Follow applicable notification obligations through qualified review. Repair the entry point and add a regression test. Avoid copying sensitive evidence into a public GitHub issue.

## Recovery drills

Before pilot, restore a synthetic staging database to an isolated target and measure actual restore time and data point. Verify roles, migrations, read/write behavior, outbox handling, deletion/retention replay and application connection updates. Replaying pre-restore outbox rows can repeat provider effects; reconcile against provider ids and durable deduplication records.

Test a release rollback separately from a database restore. Define backup retention and provider-plan capabilities explicitly. Test loss of a developer laptop without needing its local `.env`; recovery depends on controlled secret management and documentation, not one machine.

## Cost model

Do not describe the product as free. Use a budget worksheet with volume assumptions and current provider pricing before provisioning paid services. Include hosting, database compute/storage/backups/egress, mobile builds/accounts, maps, authentication/SMS, notifications, files/scanning, logging, payment fees, verification providers and support operations. Insurance and driver compensation are business costs outside cloud hosting.

Estimate tracking volume explicitly. For an illustrative synthetic scenario of 20 active drivers, four tracked hours per driver-day and one upload per requested 3 seconds: `20 * 4 * 3600 / 3 = 96,000` samples per day before batching/retries. Retained samples, DB writes, API calls and viewer reads are different billing dimensions. Adjust for actual concurrency and active legs rather than assuming every registered driver tracks all day.

On-demand dispatch also needs online-unassigned driver location/heartbeats. Add that volume separately; it may exceed active-trip traffic when utilization is low. Budget quote requests, candidate ETA lookups, timed offers, failed searches, payment authorizations/releases and realtime fanout. Cap candidate route lookups per search rather than calculating an unbounded fleet matrix.

For fallback viewer polling, estimate `concurrent_viewers * visible_seconds / poll_interval`. Route recalculation should be substantially less frequent than GPS uploads and triggered by meaningful changes. Budget WebSocket reconnections, authorized reads per location invalidation and direct database listeners as well. Staging is not automatically free. Budget Places search/autocomplete, route matrices and geocoding separately from native map display. [Google Maps pricing](https://developers.google.com/maps/billing-and-pricing/pricing)

Set spending alerts, provider quotas, rate limits, retention limits and usage dashboards. An alert is not always a hard cap. A hard cap on a critical live-trip dependency can cause an outage, so define degraded behavior and operator escalation before enabling it. Keep nonessential features separate from core ride execution.

Vercel plan suitability, Neon recovery/compliance features and paid provider agreements must be verified at procurement. In particular, evaluate commercial-use terms rather than assuming a free development tier covers Rove's operations. [Vercel Hobby guidance](https://vercel.com/docs/plans/hobby)

## When to change architecture

The B2B dashboard has its own hosting/build costs and optional reporting/funding workloads. Give those quotas and backpressure so a large institutional batch does not degrade consumer matching. Dashboard downtime must not stop consumer rides or accepted sponsored trips, but core API downtime is shared: repository separation alone is not infrastructure isolation.

Measure queue lag, database contention, connection use, tracking cost and deployment coupling. Optimize queries, indexes, retention and batching first. Extract tracking or a specialized optimization worker when sustained measurements or isolation requirements justify it. Keep Postgres as ride/financial source of truth. AWS or another host is an option at that point, not a mandatory migration at a particular arbitrary user count.

## Internal dashboard operations

The separate internal-dashboard repository has its own hosting, build, session and monitoring costs. Assign an owner for staff UI incidents and track the deployed client/API compatibility pair. Automated rides must not depend on its web server, but loss of support/safety tools needs an escalation procedure and a decision on pausing new bookings if safe support cannot be maintained. Staff mutations and durable audit records remain in the core API/database; UI rollback never rolls back core data. See [repository boundaries](15-repository-boundaries.md).
