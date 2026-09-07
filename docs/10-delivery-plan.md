# Delivery plan and acceptance gates

Status: ordered implementation plan. Estimates should be made after each milestone's scope is confirmed; this is not a promise that a production transport service can be delivered in a fixed number of days.

## Ownership

Initially the founder is product/operations owner and the implementing engineer owns technical delivery. Assign named owners as the team grows. Operational decisions include payer, service boundaries, staff coverage and provider contracts. Engineering decisions include implementation, tests and measured platform suitability. A gate requiring a business answer must not be silently replaced with a developer assumption.

## M0: Scope and architecture baseline

Deliver the current documentation set, reviewed decision register and pilot assumptions. Confirm that `Rove_Mobile` is separate from the website. Identify open payer, driver, accessibility, return-window and privacy questions. A source memo's statement to delay development is context about commercial validation, not an instruction overriding the user's request to plan/build.

Exit: founder can describe the first rider population, who dispatches, and the proposed payer flow; unresolved items are explicitly tracked. Documentation exists in GitHub. No application is claimed complete.

## M1: Repository foundation

Create pnpm/Turborepo configuration, compatible TypeScript/Expo/Node baselines, minimal rider/driver shells, admin shell and API health route. Implement dependency restrictions, example environment files, lint/types/unit test scaffolds and docs checks. Add real CI and required gate only when it reports.

Set up synthetic local fixtures and disposable database workflow. Link the correct Neon project/branch from the new product checkout; resolve the previous research-folder setup deliberately. Keep all credentials out of Git. Vercel/EAS projects are created only with deployable source and the required release authorization.

Exit: clean checkout can install using the documented pinned tooling; the API/admin start locally; both mobile shells run in development builds; CI detects a deliberate type/test/boundary failure. A fresh developer does not need the founder's production credentials.

## M2: Authentication and tracking feasibility

Build the provider-auth proof on both platforms and admin. Resolve the authentication ADR using recovery, revocation, native callbacks, staff MFA, cost and vendor suitability evidence. Implement identity mapping and an initial tenant/grant model.

Build a driver GPS proof with synthetic ride context, locked-screen/background navigation, lost connectivity and stale-display handling. Evaluate initial polling versus realtime using measured battery/latency/load. Select encrypted offline persistence before using real rider data.

Exit: signed-in devices refresh sessions correctly; revoked access is denied; location restrictions and termination behavior are documented on physical devices. A decision record names the chosen providers and limitations. This milestone can change the tracking adapter without rewriting the domain.

## M3: First complete scheduled ride

Implement rider profiles, organization/program scope, one-time ride request, operator queue, eligibility metadata, assignment offer/acceptance and ride milestones. Add current ride view and generic update notifications. Include basic cancellation and operator exceptions; do not hide missing coverage.

Exit: a synthetic ride is requested in the rider app, assigned in admin, accepted/completed in the driver app, and visible to an authorized caregiver. Another tenant, an ungranted caregiver and an unassigned driver are denied. Concurrent assignment cannot double-book. The same request retried produces one ride.

## M4: Recurrence and return coordination

Add bounded schedule generation, per-date exceptions, series versioning, timezone/DST behavior and explicit return readiness. Add delayed intents, outbox reconciliation, expired-offer handling and overdue-return escalation to the staffed queue. Include support for operators booking for riders without phones.

Exit: a weekly plan generates no duplicates when retried, schedule changes do not alter completed history, cancelled reminders do not send, and a ready return with no coverage reaches an operator. Device loss or a push outage does not make the return invisible to dispatch.

## M5: Funding and driver operations

Choose and implement one approved pilot funding model: prepaid authorization or invoiced sponsor, rather than both simultaneously. Record agreed rate snapshots and driver payable amounts. Integrate a provider sandbox where appropriate, with ledger invariants, duplicate prevention, reversals, reconciliation and clear pending/disputed states.

Implement documented driver/vehicle verification and expiry controls; use manual review initially if appropriate. Add private document storage only when required, with scanning, access control, lifecycle and vendor approval. Resolve subscription/fee treatment before charging anyone.

Exit: parallel bookings cannot exceed the authorized balance/cap; repeated provider events cannot settle twice; unknown provider results reconcile; refunds preserve history. Test-mode payments remain segregated. Operating eligibility and commercial responsibilities have named owners.

## M6: Pilot readiness

Complete real-device tests, accessible end-to-end journeys, security review, account revocation, provider agreements, data retention, monitoring, incident contacts and restore drill. Configure correct release/promotion behavior, database roles, production region, rate/budget controls and store disclosures.

Exit: a release candidate has recorded test evidence on iOS and Android; approved operating staff can handle no-shows, missing drivers and return delays; backup recovery and a code rollback are rehearsed; production data/provider requirements are approved. Real ride launch requires operational readiness as well as software readiness.

## M7: Controlled pilot and measured expansion

Start with a small approved cohort and staffed service windows. Review late pickups, stale GPS, failed reminders, financial discrepancies and support cases daily. Fix operational defects before widening service area. Add route optimization, additional payer models, subscriptions or consumer rides only when supported by measured needs and an updated decision record.

Exit: expansion criteria are agreed from pilot evidence; software capacity, driver supply and service coverage all support the change. A larger user count alone is not proof of a successful care-transport service.

## Suggested first implementation PRs

1. Workspace/tooling and executable docs/static CI.
2. API/admin/mobile shells with synthetic local setup and build checks.
3. Authentication provider proof and accepted auth ADR.
4. Driver location proof and real-device test report.
5. Initial schema, roles, migrations and isolation tests.
6. One-time ride request and operator assignment with concurrency tests.

Keep PRs reviewable around one deliverable. Do not make one giant scaffold PR claim it completes authentication, money movement and fleet operations. Authorizing this architecture commit does not automatically authorize production data changes or application releases.
