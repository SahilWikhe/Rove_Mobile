# Rove product architecture

Rove is a consumer ride-hailing product: a rider requests a ride, the platform finds an available driver, and the rider follows the trip through payment and completion. This repository is the **core product monorepo** for the rider app, driver app, shared ride-platform backend, and database. The internal staff dashboard and optional institution-facing B2B dashboard each belong in their own separate repository. The marketing website remains in [SahilWikhe/Rove](https://github.com/SahilWikhe/Rove).

## Current status

This repository contains the architecture plans and an in-progress implementation of the rider/driver apps, shared API, database and automated tests. See the [implementation ledger](docs/18-implementation-status.md) for verified behavior and remaining work, and [local development](docs/19-local-development.md) to run the synthetic integration environment. **This is not a production-ready release.** Planned controls are requirements until implementation and verification evidence exists. The consumer-first scope supersedes the original care-pilot-first architecture; see [the decision history](docs/12-decisions.md).

The proposed technical baseline is React Native + Expo for mobile, a Hono/TypeScript API on Vercel, and Postgres on Neon. A small Next.js staff console in a separate repository supports Rove operations; a third product repository holds the optional B2B dashboard. Both dashboards consume the shared API. Use a modular backend with one transactional ride database before considering separate services.

Driver background tracking details and remaining device checks are recorded in [driver location lifecycle](docs/20-driver-location.md).

## Reading order

| Document | Purpose |
| --- | --- |
| [Product scope](docs/01-product-scope.md) | Consumer ride-hailing, optional B2B scope, and open business decisions |
| [System architecture](docs/02-system-architecture.md) | Components, dependency rules, request flows, and technology decisions |
| [Data model](docs/03-data-model.md) | Entities, ownership, constraints, transactions, retention, and migrations |
| [API and domain behavior](docs/04-api-and-domain.md) | Contracts, ride lifecycle, scheduling, concurrency, and failure handling |
| [Mobile architecture](docs/05-mobile-apps.md) | Rider/driver structure, authentication, offline behavior, location, and accessibility |
| [Security and privacy](docs/06-security-and-privacy.md) | Threat model, permissions, tenant isolation, secrets, and launch requirements |
| [Testing strategy](docs/07-testing-strategy.md) | Test tools, scenario matrix, quality gates, and release evidence |
| [CI/CD and environments](docs/08-cicd-and-environments.md) | PR checks, preview isolation, migrations, deployments, and app-store releases |
| [Engineering standards](docs/09-engineering-standards.md) | Modular coding, TypeScript, dependencies, reviews, and observability conventions |
| [Delivery plan](docs/10-delivery-plan.md) | Ordered milestones, acceptance criteria, owners, and decision gates |
| [Operations and costs](docs/11-operations-and-costs.md) | Reliability targets, incident procedures, recovery, and cost model |
| [Architecture decisions](docs/12-decisions.md) | Decisions, tradeoffs, alternatives, and conditions for reconsideration |
| [Sources and assumptions](docs/13-sources-and-assumptions.md) | Source provenance, verified platform references, and uncertain claims |
| [Repository boundaries](docs/15-repository-boundaries.md) | Three product repos, ownership, staff dashboard and cross-repo delivery |
| [B2B product boundary](docs/14-b2b-product-boundary.md) | Separate repository, shared API ownership, access, and independent releases |

Read [CONTRIBUTING.md](CONTRIBUTING.md) before implementing a feature. Coding agents should also follow [AGENTS.md](AGENTS.md).

For staging account configuration and remaining owner decisions, read [provider setup handoff](docs/62-provider-setup-handoff.md).

## First useful milestone

Using synthetic data on real iOS and Android devices: a rider gets a quote and requests a ride; an online eligible driver receives a time-limited offer, accepts, picks up and completes the trip; payment settles once in sandbox and the rider receives a receipt. Also prove no-driver, cancellation, payment-failure and lost-connectivity behavior. This must work with no institution, sponsor or B2B dashboard configured.

## Product repositories

| Repository | Responsibility |
| --- | --- |
| `Rove_Mobile` (this repository) | Rider/driver apps, matching, ride execution, consumer payments, database/migrations, staff authorization and operational API use cases |
| Internal dashboard repository (name TBD; not created) | Rove staff UI for approvals, support, safety and finance; staff sessions/API proxy |
| B2B repository (name TBD; not created) | Institution dashboard, organization administration, sponsored booking UI, reports and optional thin web session/API proxy |
| `Rove` (existing) | Marketing website |

There are three product repositories, plus the existing website repository: four repositories total. Both dashboards use versioned APIs; neither gets direct core database access or its own competing matching/payment engine. See [repository boundaries](docs/15-repository-boundaries.md).

## Repository boundary

The initial Neon setup was performed in a separate local research directory named `Rove`. Its `.env.local`, `.neon`, installed packages, and credentials do not belong in this documentation commit. The product now has an isolated synthetic Neon staging branch with applied migrations and a verified backend smoke flow; see [Neon staging](docs/60-neon-staging.md). Local previews remain on disposable PostgreSQL, and this is not a deployed production backend. See the [environment plan](docs/08-cicd-and-environments.md) before linking application environments.

The architecture documents include future components. The root `pnpm test`, `pnpm typecheck` and `pnpm docs:check` commands are implemented; production deployment is not yet configured.

## Mobile design implementation baseline

Use the supplied Figma screens and theme with the approved changes recorded in [mobile design contract](docs/16-mobile-design-contract.md). It maps existing frames and specifies missing rider/driver journeys. [Scheduling feature flags](docs/17-scheduling-feature-flags.md) defines the default-off advance/weekly/monthly rollout, recommended Vercel integration, backend enforcement and existing-booking protection. Consumer-funded rides remain primary; the Pro subscription and 100%-fare promises are removed. These specifications are not implemented apps or configured flags.
