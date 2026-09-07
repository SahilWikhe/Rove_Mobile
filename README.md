# Rove product architecture

Rove is a consumer ride-hailing product: a rider requests a ride, the platform finds an available driver, and the rider follows the trip through payment and completion. This repository is the **core product monorepo** for the rider app, driver app, shared ride-platform backend, and essential Rove staff tools. The optional institution-facing B2B dashboard belongs in a separate repository. The marketing website remains in [SahilWikhe/Rove](https://github.com/SahilWikhe/Rove).

## Current status

This repository currently contains architecture and implementation plans only. **No application, database schema, automated checks, or deployment has been implemented here.** A described control is a requirement to implement and verify, not a claim that it already exists. The consumer-first scope supersedes the original care-pilot-first architecture; see [the decision history](docs/12-decisions.md).

The proposed technical baseline is React Native + Expo for mobile, a Hono/TypeScript API on Vercel, and Postgres on Neon. A small Next.js staff console supports Rove operations; a separately deployed B2B dashboard is an optional API client. Use a modular backend with one transactional ride database before considering separate services.

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
| [B2B product boundary](docs/14-b2b-product-boundary.md) | Separate repository, shared API ownership, access, and independent releases |

Read [CONTRIBUTING.md](CONTRIBUTING.md) before implementing a feature. Coding agents should also follow [AGENTS.md](AGENTS.md).

## First useful milestone

Using synthetic data on real iOS and Android devices: a rider gets a quote and requests a ride; an online eligible driver receives a time-limited offer, accepts, picks up and completes the trip; payment settles once in sandbox and the rider receives a receipt. Also prove no-driver, cancellation, payment-failure and lost-connectivity behavior. This must work with no institution, sponsor or B2B dashboard configured.

## Product repositories

| Repository | Responsibility |
| --- | --- |
| `Rove_Mobile` (this repository) | Rider/driver apps, matching, ride execution, consumer payments, database/migrations and Rove internal support tools |
| B2B repository (name TBD; not created) | Institution dashboard, organization administration, sponsored booking UI, reports and optional thin web session/API proxy |
| `Rove` (existing) | Marketing website |

There are two product repositories, plus the existing website repository. The B2B product uses versioned APIs; it does not get direct access to the core database or its own competing matching/payment engine.

## Repository boundary

The initial Neon setup was performed in a separate local research directory named `Rove`. Its `.env.local`, `.neon`, installed packages, and credentials do not belong in this documentation commit. Provisioning a Neon project does not imply that this repository is connected or production-ready. See the [environment plan](docs/08-cicd-and-environments.md) before linking application environments.

Future source folders shown in these documents are proposed paths. Commands described as future scripts will become executable during the foundation milestone. Do not assume `pnpm test` or a deployment command works yet.
