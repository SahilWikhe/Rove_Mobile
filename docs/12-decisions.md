# Architecture decision records

Status definitions: **Selected** is the current architecture baseline; **Provisional** needs feasibility evidence; **Open** requires a business/vendor choice; **Superseded** records an earlier direction that must no longer guide implementation. None means deployed.

## Scope revision history

The initial `c52573c` documentation baseline focused on scheduled care rides, institutional funding, manual dispatch and one product monorepo containing the customer-facing dashboard. The user's subsequent clarification replaces that product direction with primary consumer ride-hailing and an optional B2B dashboard in a separate repository. The records below preserve that change explicitly.

## ADR-001: Three product repositories and separate marketing

**Selected; revised September 7, 2026.** `Rove_Mobile` owns rider/driver apps, shared API/domain/database, staff authorization and operational API use cases. A separate internal-dashboard repository owns Rove staff UI/sessions. A third product repository owns the optional institutional dashboard. Both dashboard repository names are TBD; neither is created by this documentation change. Marketing stays in `Rove`.

Reason: the user wants independent ownership and releases for mobile/backend, internal staff UI and institution UI. Consequence: three product repositories plus marketing (four total), versioned cross-repository contracts and independent CI/releases. This supersedes the `5140451` arrangement that placed internal `apps/ops` in the core repo. Alternatives were retaining internal tools in the core monorepo or splitting backend/mobile too. Keep the backend with core mobile for coordinated feature work; do not duplicate the ride engine in the dashboard repository.

## ADR-002: Two Expo applications

**Selected.** Consumer rider app and driver app, each supporting iOS and Android. Share appropriate native components/contracts, not all screen layouts. Caregiver and schedule features are optional extensions.

Reason: drivers need online availability, offer handling, background discovery/trip tracking and earnings; riders need quotes, booking, tracking and payment. Consequence: separate native identifiers/builds/releases, compatible SDK versions and real-device evidence. Revisit native implementation only for demonstrated limitations.

## ADR-003: One authoritative modular ride backend

**Selected; clarifies original ADR-003.** Hono on Node.js/Vercel, plain TypeScript domain modules and Neon Postgres. A Next.js app in the separate internal-dashboard repo serves Rove staff. It and the separate optional B2B web app are scoped API clients; either may have a thin session proxy, but neither owns trip/payment mutations or core database access.

Reason: shared matching, availability and financial truth. Consequence: one backend outage is shared even with separate repositories. B2B batch/reporting work needs quotas/backpressure. Revisit service extraction for measured contention, security boundaries or ownership needs.

## ADR-004: Platform-owned Postgres model

**Selected; revises original tenancy assumption.** Consumer riders, drivers and rides do not require organization membership. Optional institution memberships and sponsorship associations authorize only relevant B2B resources. Drizzle, scoped SQL, constraints, transactions and migrations remain the baseline.

Reason: consumer-only operation must work with no institution present. Consequence: explicit resource ownership, market-scoped matching and no fake default tenant. The B2B repository never receives core DB credentials or migration authority. Validate geospatial indexes and transaction-capable driver behavior in implementation.

## ADR-005: Managed authentication

**Selected September 9, 2026; integration verification still gates M2.** Use Auth0, configured directly through its dashboard or authenticated CLI. Create an isolated staging tenant with two public Native clients (rider and driver) and one shared API audience/user directory. Production will use a separate tenant. Rove retains consumer/driver/staff authorization in its backend; institution roles remain distinct from staff capabilities.

Reason: the existing Expo AuthSession PKCE flow and Hono OIDC validation fit direct native-client/API configuration. Vercel continues hosting the backend and Neon remains the application database. Marketplace provisioning is unnecessary for this setup. Neon Auth is not the selected identity authority. Provider selection does not prove native integration, authorize a paid plan or activate production.

Acceptance: native callbacks/PKCE, refresh/revocation, recovery, staff MFA, account lifecycle, test isolation, cost and relevant agreements. Provider membership features must not force institutions into consumer account creation.

## ADR-006: Durable jobs and short matching deadlines

**Selected durability pattern; provisional executor.** Persist intents with state changes, execute idempotently and reconcile retries. Vercel Workflow is a candidate for durable execution, but short timed offers require measured wakeup and delivery latency before choosing the matching executor in M2/M3.

Reason: jobs survive failure while server-clock expiry and transactions protect correctness. Alternative: minute-level cron or in-memory timers as the sole matching engine. Consequence: persisted attempts/offers, deadline validation, bounded retry and old-generation rejection. Provider delay must not extend a valid acceptance window.

## ADR-007: Availability and trip transport

**Provisional.** HTTPS plus bounded polling can validate synthetic flows. Benchmark realtime or faster foreground refresh for short driver offers before launch; push alone is not sufficient. Discovery locations are private to matching; rider-visible tracking starts only with authorized accepted work.

Acceptance: real-device background behavior, freshness, online expiry, offline/revoked access, reconnect/resync, fanout, cost and battery. Vercel's current guidance describes native WebSockets with lifetime/reconnect considerations; confirm the actual runtime in the spike. [Vercel WebSocket guidance](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)

## ADR-008: Maps and native navigation

**Selected initial direction.** Google map/address/route adapters with validated key restrictions and terms; native navigation handoff first. Proximity shortlists drivers, and bounded ETA calculations rank candidates; straight-line distance is not driving time.

Reason: workable discovery/quote/pickup flow without building embedded navigation initially. Consequence: budgets for quote searches and candidate ETA calls as well as map display. Revisit provider for coverage, terms or measured cost issues.

## ADR-009: Consumer payments first

**Selected direction; supersedes sponsored-first ADR-009.** Rider-funded quotes, payment-method setup, authorization/release, completion capture, refunds, receipts and driver earnings belong to the core. Processor/charge model, fare rules, driver compensation and fee responsibilities remain open business choices. Rove Pro subscriptions, $199/month and 100%-fare guarantees are removed from scope by the September 7 approval; historical subscription hypotheses are superseded.

Consequence: server-owned fare snapshots, provider idempotency, financial reconciliation and a ledger; trip completion stays independent of settlement outcome. Institutional prepaid/invoiced funding becomes a later adapter with explicit authorization and no silent payer switching. Stripe Connect remains a candidate pending fit/responsibility review.

## ADR-010: Independent releases and versioned contracts

**Selected.** Each repository has its own CI/release controls. Core owns schema/API evolution and compatible migration; each dashboard pins a published contract/client. Mobile binaries, core API, ops and institution UI can release independently within compatibility windows.

Consequence: no cross-repo workspace imports or reliance on simultaneous merges. Test supported internal-dashboard, B2B and older mobile contracts against candidate core APIs. Production promotion and mobile submission remain explicit release actions; configure Vercel defaults accordingly.

## ADR-011: Modular reuse

**Selected.** Enforce domain/public package boundaries, vendor ports and stable transport contracts. Keep matching, pricing, consumer payment and optional institution policy as separate modules in the shared backend. Share frontend primitives only where behavior fits.

Reason: modularity comes from responsibilities and APIs, not repository count alone. Consequence: prevent direct table access from B2B and duplicated pricing/matching logic. Avoid both giant handlers and generic abstraction frameworks without concrete purpose.

## ADR-012: Consumer launch and extension-specific readiness

**Selected; revises care-first gate.** Consumer launch requires driver/vehicle/operating readiness, payment responsibilities, privacy/security, recovery and support coverage. Institutions or healthcare contracts are not universal prerequisites. Review additional B2B/healthcare requirements before enabling those programs.

Consequence: use synthetic development data, no claims of compliance from documentation, and feature-specific acceptance evidence. A consumer trip must complete with B2B disabled; accepted sponsored trips must continue if the dashboard later becomes unavailable.

## ADR-013: Automated matching is core

**Selected; supersedes manual-dispatch-first scope.** Sequential time-limited offers among eligible online drivers, with bounded candidate selection and search deadline. Acceptance atomically claims ride and driver. Staff dispatch is an audited exception path, not normal booking.

Reason: the user wants the primary product to operate like Uber/Lyft. Consequence: driver presence, geospatial discovery, quote/payment readiness, expiry races, no-driver handling and matching observability become MVP work. Fanout, surge pricing, pooling and AI are optional optimizations, not implied requirements.

## ADR-014: Figma baseline with approved product overrides

**Selected September 7, 2026.** Preserve rider/driver Figma layouts and black/gold Manrope theme. Consumer payment replaces default NEMT/Medicaid coverage. Remove Pro subscriptions and 100%-fare promises. Add missing auth/payment/onboarding/recovery/start-trip flows in the same design language. Pre-acceptance offers exclude exact endpoints, rider identity/history and medical/payer information. See [design contract](16-mobile-design-contract.md).

## ADR-015: Default-off scheduling with protected existing work

**Selected behavior; recommended provider pending proof.** Advance, weekly and monthly scheduling remain planned behind server-enforced default-off flags. Recommend Vercel Flags through its framework-neutral core library in Hono; Expo reads only effective API capabilities. Use a small adapter and deterministic test implementation. No deployment/provider setup is implied.

Flags gate admission/expansion; existing commitments continue with view/cancel/support access. Missing/provider-failed evaluation denies new scheduling without breaking ordinary rides. Validate platform fit, costs, timing, monthly recurrence and rollback before cohort rollout. See [flag plan](17-scheduling-feature-flags.md).
