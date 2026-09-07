# Architecture decision records

Status definitions: **Selected** is the current architecture baseline; **Provisional** needs feasibility evidence; **Open** requires a business/vendor choice; **Superseded** records an earlier direction that must no longer guide implementation. None means deployed.

## Scope revision history

The initial `c52573c` documentation baseline focused on scheduled care rides, institutional funding, manual dispatch and one product monorepo containing the customer-facing dashboard. The user's subsequent clarification replaces that product direction with primary consumer ride-hailing and an optional B2B dashboard in a separate repository. The records below preserve that change explicitly.

## ADR-001: Core monorepo and separate B2B repository

**Selected; revises original ADR-001.** `Rove_Mobile` owns rider/driver apps, shared API/domain/database and essential Rove internal ops. A separate repository, name TBD, owns the optional institutional dashboard. Marketing stays in `Rove`.

Reason: the user wants independently scoped consumer and institutional products. Consequence: two product repositories plus marketing, versioned cross-repository contracts and independent releases. Alternatives were one product repo for both surfaces or separate backend/mobile repos. Keep the backend with core mobile for coordinated feature work; do not duplicate the ride engine in the dashboard repository.

## ADR-002: Two Expo applications

**Selected.** Consumer rider app and driver app, each supporting iOS and Android. Share appropriate native components/contracts, not all screen layouts. Caregiver and schedule features are optional extensions.

Reason: drivers need online availability, offer handling, background discovery/trip tracking and earnings; riders need quotes, booking, tracking and payment. Consequence: separate native identifiers/builds/releases, compatible SDK versions and real-device evidence. Revisit native implementation only for demonstrated limitations.

## ADR-003: One authoritative modular ride backend

**Selected; clarifies original ADR-003.** Hono on Node.js/Vercel, plain TypeScript domain modules and Neon Postgres. Next.js `apps/ops` serves internal Rove staff. The separate B2B web app is an optional scoped API client; it may have a thin session proxy but no independent trip/payment mutations.

Reason: shared matching, availability and financial truth. Consequence: one backend outage is shared even with separate repositories. B2B batch/reporting work needs quotas/backpressure. Revisit service extraction for measured contention, security boundaries or ownership needs.

## ADR-004: Platform-owned Postgres model

**Selected; revises original tenancy assumption.** Consumer riders, drivers and rides do not require organization membership. Optional institution memberships and sponsorship associations authorize only relevant B2B resources. Drizzle, scoped SQL, constraints, transactions and migrations remain the baseline.

Reason: consumer-only operation must work with no institution present. Consequence: explicit resource ownership, market-scoped matching and no fake default tenant. The B2B repository never receives core DB credentials or migration authority. Validate geospatial indexes and transaction-capable driver behavior in implementation.

## ADR-005: Managed authentication

**Open; gate M2.** Evaluate Neon Auth and a managed OIDC provider with supported Expo flows. Choose one initial identity authority, with Rove-owned consumer/driver/staff authorization. Institution roles later remain distinct from staff capabilities.

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

**Selected direction; supersedes sponsored-first ADR-009.** Rider-funded quotes, payment-method setup, authorization/release, completion capture, refunds, receipts and driver earnings belong to the core. Processor/charge model, fare rules, driver commission/subscription and fee responsibilities remain open business choices. Historical $20/month economics are not confirmed requirements.

Consequence: server-owned fare snapshots, provider idempotency, financial reconciliation and a ledger; trip completion stays independent of settlement outcome. Institutional prepaid/invoiced funding becomes a later adapter with explicit authorization and no silent payer switching. Stripe Connect remains a candidate pending fit/responsibility review.

## ADR-010: Independent releases and versioned contracts

**Selected.** Each repository has its own CI/release controls. Core owns schema/API evolution and compatible migration; B2B pins a published contract/client. Mobile binaries, core API, ops and institution UI can release independently within compatibility windows.

Consequence: no cross-repo workspace imports or reliance on simultaneous merges. Test supported B2B and older mobile contracts against candidate core APIs. Production promotion and mobile submission remain explicit release actions; configure Vercel defaults accordingly.

## ADR-011: Modular reuse

**Selected.** Enforce domain/public package boundaries, vendor ports and stable transport contracts. Keep matching, pricing, consumer payment and optional institution policy as separate modules in the shared backend. Share frontend primitives only where behavior fits.

Reason: modularity comes from responsibilities and APIs, not repository count alone. Consequence: prevent direct table access from B2B and duplicated pricing/matching logic. Avoid both giant handlers and generic abstraction frameworks without concrete purpose.

## ADR-012: Consumer launch and extension-specific readiness

**Selected; revises care-first gate.** Consumer launch requires driver/vehicle/operating readiness, payment responsibilities, privacy/security, recovery and support coverage. Institutions or healthcare contracts are not universal prerequisites. Review additional B2B/healthcare requirements before enabling those programs.

Consequence: use synthetic development data, no claims of compliance from documentation, and feature-specific acceptance evidence. A consumer trip must complete with B2B disabled; accepted sponsored trips must continue if the dashboard later becomes unavailable.

## ADR-013: Automated matching is core

**Selected; supersedes manual-dispatch-first scope.** Sequential time-limited offers among eligible online drivers, with bounded candidate selection and search deadline. Acceptance atomically claims ride and driver. Staff dispatch is an audited exception path, not normal booking.

Reason: the user wants the primary product to operate like Uber/Lyft. Consequence: driver presence, geospatial discovery, quote/payment readiness, expiry races, no-driver handling and matching observability become MVP work. Fanout, surge pricing, pooling and AI are optional optimizations, not implied requirements.
