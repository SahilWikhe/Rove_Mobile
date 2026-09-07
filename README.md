# Rove product architecture

Rove coordinates recurring care transportation: getting riders to their destinations and reliably bringing them home. This repository is the **product monorepo** for the rider/caregiver app, driver app, operations dashboard, and backend. The marketing website remains in [SahilWikhe/Rove](https://github.com/SahilWikhe/Rove).

## Current status

This first commit contains architecture and implementation plans only. **No application, database schema, automated checks, or deployment has been implemented here.** A described control is a requirement to implement and verify, not a claim that it already exists.

The proposed technical baseline is React Native + Expo for mobile, Next.js for the operations dashboard, a Hono/TypeScript API on Vercel, and Postgres on Neon. Use a modular backend with one transactional database before considering separate services.

## Reading order

| Document | Purpose |
| --- | --- |
| [Product scope](docs/01-product-scope.md) | Users, pilot assumptions, boundaries, and unresolved business decisions |
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

Read [CONTRIBUTING.md](CONTRIBUTING.md) before implementing a feature. Coding agents should also follow [AGENTS.md](AGENTS.md).

## First useful milestone

Using synthetic data on real iOS and Android devices: a rider requests a scheduled ride, an operator assigns an eligible driver, the driver accepts and completes the ride, and the rider or authorized caregiver receives the correct status. Prove background tracking and lost-connectivity behavior early. Recurrence, return coordination, and billing build on this flow.

## Repository boundary

The initial Neon setup was performed in a separate local research directory named `Rove`. Its `.env.local`, `.neon`, installed packages, and credentials do not belong in this documentation commit. Provisioning a Neon project does not imply that this repository is connected or production-ready. See the [environment plan](docs/08-cicd-and-environments.md) before linking application environments.

Future source folders shown in these documents are proposed paths. Commands described as future scripts will become executable during the foundation milestone. Do not assume `pnpm test` or a deployment command works yet.
