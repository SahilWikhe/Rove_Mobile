# Architecture decision records

Status definitions: **Selected** is the proposed implementation baseline approved for this architecture package; **Provisional** needs a bounded feasibility result; **Open** requires a product/vendor decision. None means deployed. Change these records through review when evidence changes.

## ADR-001: Separate product monorepo

**Selected.** Use `SahilWikhe/Rove_Mobile` for rider, driver, admin and API. Keep the marketing website in `SahilWikhe/Rove`.

Reason: the user explicitly wants product and marketing separated, while product changes benefit from one review and shared contracts. Alternatives were one repository including the website or separate backend/mobile repositories. Consequence: product deployment remains independent of marketing; intra-product package boundaries need automated enforcement. Revisit if access control or separately owned teams require repository separation.

## ADR-002: Two Expo applications

**Selected**, subject to device feasibility. One rider/caregiver app and one driver app, each supporting iOS and Android. Share suitable native components and contracts. Use development builds for native/location evaluation.

Reason: driver permissions, operational screens and release cadence differ from rider needs. Alternatives: one role-switched app or fully native Swift/Kotlin apps. Consequence: two store/build configurations and shared-version maintenance. Revisit only after demonstrated native limitations, not speculative performance concerns.

## ADR-003: Modular backend on Vercel

**Selected.** Hono on Node.js for the API, Next.js for admin, domain modules independent of transport, one Postgres database. Separate Vercel projects for API/admin; jobs may share API code and infrastructure initially.

Reason: explicit API boundary for native clients with modest operations overhead. Alternatives: API routes embedded in admin, microservices, or AWS-first hosting. Consequence: extra deployable compared with one full-stack web app, but clearer mobile API ownership. Do not duplicate business rules in Next.js server actions. Revisit hosting for measured constraints, not because a mobile app exists.

## ADR-004: Postgres on Neon with Drizzle

**Selected.** Use relational schema, scoped constraints, transactions, versioned migrations, and pooled connections. Use a transaction-capable driver for race-sensitive workflows. Isolate production from synthetic environments.

Reason: scheduling, assignment, funding and audit relationships require reliable constraints and reporting. Alternative: a document database or client-accessible generic data backend. Consequence: migrations and SQL correctness are engineering responsibilities. No database secrets in clients. Revisit provider based on supported extensions, latency, recovery, contracts and cost; preserve portable data/domain design.

## ADR-005: Managed authentication

**Open; gate M2.** Evaluate Neon Auth and a managed OIDC provider with documented Expo support. Select exactly one user identity authority for the initial release. The API owns Rove roles and caregiver/tenant authorization regardless of provider.

Acceptance: native callback/PKCE, token validation/refresh/revocation, recovery, staff MFA, user export/deletion, staging isolation, cost and required agreements. Alternatives include self-hosted auth, but custom password/OTP infrastructure is not the default. Record a real device/sandbox result before committing to a provider.

## ADR-006: Durable intents and workflows

**Selected pattern; provisional Vercel Workflow adapter.** Persist outbox intent in the ride transaction; use durable handlers with per-handler deduplication, bounded retries and reconciliation. Validate the chosen Workflow SDK/runtime integration in M4.

Reason: physical operations and notifications must survive deployments and process failures. Alternatives: in-memory timers, only cron, or independent queue infrastructure from day one. Consequence: outbox leasing/deduplication and operator replay need tests. A scheduled sweeper is allowed for discovery/repair, not the only record of intended work. Revisit execution vendor if supported runtime, reliability or pricing fails the spike.

## ADR-007: Tracking transport

**Provisional.** Start the synthetic vertical slice with HTTPS ingestion and bounded visible-screen polling. Before pilot, benchmark native Vercel WebSockets or a managed realtime provider if required for freshness/fanout/cost.

Reason: first prove OS background behavior and authorization with few moving parts. Vercel's current WebSocket guidance describes support with function-lifetime/reconnect considerations; older pages and earlier advice may differ, so verify the actual platform/runtime in the spike. [Vercel WebSocket guidance](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)

Acceptance: scoped access, reassignment/revocation, reconnect/resync, stale detection, cross-instance behavior, realistic cost and physical-device battery results. Persist latest location and operational history independently of transport. No guaranteed continuous tracking after force-stop.

## ADR-008: Maps and driver navigation

**Selected initial direction.** Google map/address/route services with provider adapters; native navigation handoff initially. Key restrictions and data/attribution terms are required.

Reason: suitable address/ETA capability without immediately building an embedded navigation product. Alternatives: Apple-only services, Mapbox, full Navigation SDK. Consequence: billable services and app-switch/background testing. Revisit provider if coverage, terms, cost or accessibility fail pilot requirements.

## ADR-009: Sponsored billing first

**Open funding model; selected integrity requirements.** The founder must choose prepaid versus invoiced pilot contract and payment responsibilities. Implement that first, with immutable rate snapshots, transactional authorization, balanced ledger entries, idempotent provider operations and reconciliation.

Reason: source brief proposes prepayment and driver subscription, while research warns the actual payer may follow reimbursement/procurement rules. Alternative: assume all rides are paid by consumer cards or all sponsors prepay. Consequence: payment integration cannot finalize until business responsibilities are known. Stripe Connect is a candidate, not a confirmed legal/commercial fit.

## ADR-010: Independent controlled releases

**Selected target.** PR checks validate affected code and dependents; production API/admin promotion and mobile submission are explicit release steps. Use compatible migrations and older-client contract tests.

Reason: one repository does not make native binaries and backend updates atomic. Alternative: automatically release every component on every merge. Consequence: configure Vercel defaults deliberately, keep release evidence and a support matrix. Revisit automation after reliable release/rollback rehearsals, without removing compatibility gates.

## ADR-011: Modular reuse without generic framework sprawl

**Selected.** Use domain modules, public package interfaces and vendor ports where needed. Share tokens/contracts/native primitives; keep screen-specific UI and vendor behavior explicit.

Reason: too much abstraction hides constraints and slows changes as much as no modularity. Alternatives: one giant application file or universal UI/repository/provider frameworks. Consequence: reviewers judge boundaries by responsibility and testability rather than file counts. Introduce new packages after demonstrated reuse or clear isolation need.

## ADR-012: Real-data launch gate

**Selected.** Development and previews use synthetic data. Before pilot, resolve operating responsibilities, sensitive-data classification, provider suitability, recovery and support coverage.

Reason: care-transport information and failures have consequences beyond a typical demo. Alternative: treating free tiers and passing unit tests as launch approval. Consequence: engineering can progress independently with fake data, while live operations depend on named business decisions. No claim of HIPAA compliance is made by this architecture.
