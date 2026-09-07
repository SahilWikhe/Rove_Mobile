# Delivery plan: core ride-hailing, then optional B2B

Status: ordered implementation plan reflecting the user's revised direction. No source, provider activation or deployment is created by this document. Milestone estimates follow confirmed scope and feasibility, not a promised app-launch date.

## Ownership and priorities

The founder owns service area/hours, pricing, driver model, payment responsibilities and operating decisions. Engineering owns implementation, tests, supported platform choices and measured reliability. Core consumer rides do not depend on signing an institutional customer. A separate B2B product can later serve institutions through the same backend.

Two product repositories plus the existing website are planned. Only `Rove_Mobile` is currently created for the product. Do not invent/create a B2B repository during documentation work. Internal Rove support and dispatch are required for consumer operations and can live in `apps/ops` here.

## M0: Revised architecture and product baseline

Document the consumer loop, repository ownership and optional add-on boundary. Identify launch-market, fare/earnings, payment and matching-policy questions. Preserve historical care research as extension context; retire manual institutional dispatch as the main journey.

Exit: the plan explicitly supports a consumer with no institution account; the founder can identify initial market/supply assumptions and open commercial choices. Documentation makes implemented status clear.

## M1: Core repository foundation

Create pnpm/Turborepo, pinned compatible Node/TypeScript/Expo baselines, rider/driver shells, API health route and minimal Rove staff shell. Add boundary enforcement, safe example environment files, synthetic fixtures and executable docs/static/test CI. Link the correct isolated Neon environment from this checkout deliberately; do not copy research-folder credentials into Git.

Exit: clean install, local API/ops startup, development mobile builds on both platforms, real failing/passing checks and synthetic DB workflow. No B2B configuration is needed to start/test the core. Provision Vercel/EAS only when source is deployable and release authorization exists.

## M2: Identity, driver availability and platform feasibility

Evaluate managed authentication for consumer/driver sessions and staff MFA. Implement platform ownership/capabilities with no mandatory organization tenant. Prove driver online/offline heartbeat and background discovery/trip tracking on physical devices, including locked screen, native navigation, reconnect and revoked permission.

Benchmark timed-offer delivery and durable executor wakeups under realistic delays. Pick polling/realtime and the job adapter based on matching deadlines, battery and cost. Resolve offline storage before real data. Use fake offers/trips and payment sandbox accounts.

Exit: tested iOS/Android auth and background behavior; stale/offline drivers leave the candidate set; expiry remains valid despite late worker/push; chosen provider decisions and limits recorded.

## M3: Consumer quote and automatic matching

Implement market/service eligibility, route/quote inputs, server-owned pricing/expiry, tokenized payment-method sandbox setup and authorization policy. Add online driver selection, bounded sequential offers, accept/decline/timeout, atomic capacity claims, rider search/match UI and no-driver recovery.

Exit: a consumer requests a quoted ride and an online driver accepts through the app without manual dispatch, institution rows or sponsor credentials. Acceptance versus cancellation, two rides versus one driver and duplicate/expired offer races pass real database tests. No-driver paths stop searching and release authorization under policy.

## M4: Complete trip, payment and internal support

Implement navigation handoff, arrival/pickup/completion, rider tracking, cancellation/rematch policy, receipts, consumer capture/refund/reconciliation and driver payable/earnings view. Complete durable outbox/retry repair and safe provider callbacks. Add staff eligibility review, ride lookup, audited intervention, incident support and finance reconciliation.

Exit: synthetic end-to-end quote -> match -> pickup -> completion -> payment/receipt/earnings works on both platforms. Lost connectivity shows pending state; a repeated callback cannot move money twice; rematching revokes old driver access. Staff handle exceptions but are not required to approve every normal request.

## M5: Consumer pilot readiness

Resolve actual pricing/driver model, payment processor/charge responsibilities, service boundaries, eligibility, insurance/operating requirements and support coverage. Add measured rate/cost controls, observability, device/accessibility evidence, restore and rollback drills, release promotion and store disclosures. Retention/privacy decisions cover actual consumer data and any sensitive features introduced.

Exit: candidate tested for core user ownership, matching integrity, consumer payments and real-device behavior. Appropriate operational approvals exist. Production and test data/providers are isolated. Disabling every B2B module/UI still leaves consumer journeys functional.

## M6: Controlled consumer launch and refinement

Start with recruited eligible supply, limited geographic coverage and staffed operating hours. Monitor conversion, no-driver rate, time to match, driver acceptance, cancellation, pickup ETA accuracy, payments and incidents. Tune candidates/deadlines from evidence; do not extend an expired offer or hide failures to improve metrics.

Exit: agreed service and reliability targets hold at controlled load. Expand supply/area only with operational support. Prioritize optional ratings, tips, schedules or promotions from product evidence; no assumption that every Uber/Lyft feature is required immediately.

## B1: Optional institution product definition

Independent later track. Founder chooses the customer use case, repository name, roles, pricing and program/funding policy. Define whether an institution books for employees, care recipients, guests or another population. Review specific data/contract obligations, especially for healthcare use.

Exit: add-on scope and named repository decision exist without rewriting the consumer product or making institutions owners of global driver/rider records.

## B2: Optional core extensions and separate dashboard

Add backend organization memberships/entitlements, explicit ride sponsorships, funding adapter and reporting APIs under module boundaries. Publish versioned contracts/client artifacts. Build the dashboard in its own repository against those APIs; no direct core database access or migrations from B2B CI.

Schedules, recurrence, caregiver grants and return readiness are optional modules added when a real product use case requires them. Implement their timezone, permission, funding and failure tests before exposing them. They may serve consumer features too and must not require an institutional tenant for personal use.

Exit: organization can arrange an authorized sponsored ride; ordinary personal trips stay private; separately released B2B clients remain compatible. B2B outage or reporting load does not break consumer matching; already accepted sponsored trips continue through the core platform.

## B3: Add-on release and expansion

Deploy B2B independently with its customer access, quotas, support and finance procedures. Gate sensitive/regulated programs on actual vendor/operational requirements. Track organization usage separately from consumer measures. Keep reports/batch work bounded and isolate high-cost jobs as measurements justify.

Exit: customer acceptance, cross-organization isolation, safe funding, contract compatibility and core-independence tests pass. Add-on changes do not force simultaneous mobile/store releases.

## First implementation PRs

1. Workspace/tooling and executable docs/static CI.
2. Core API/ops/mobile shells and synthetic database setup.
3. Auth provider proof and platform ownership/permissions.
4. Driver availability/background tracking and timed-offer feasibility report.
5. Quotes/payment sandbox, match/offer schema and transaction tests.
6. Rider request, automatic matching and driver acceptance vertical slice.

Keep PRs scoped to a reviewable outcome with real evidence. Current scope changes do not authorize application releases or production mutations. See [CI/CD](08-cicd-and-environments.md) and [B2B boundary](14-b2b-product-boundary.md).
