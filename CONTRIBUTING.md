# Contributing to Rove

This repository currently contains architecture documentation only. Implementation begins with the foundation milestone in the [delivery plan](docs/10-delivery-plan.md). Do not assume application scripts, tests or deployments exist yet.

Current scope is consumer ride-hailing. The institutional dashboard is an optional separate-repository product using the core API. Do not bring institution UI into this monorepo, duplicate the ride engine elsewhere, or make consumer booking require a sponsor. Rove's own support/dispatch tools remain a core operational responsibility. See [B2B boundary](docs/14-b2b-product-boundary.md).

## Development workflow

1. Read the relevant product scope, ADR and module requirements. State acceptance criteria before adding a feature.
2. Start a short-lived branch from current `main`; keep work scoped to one reviewable outcome.
3. Use synthetic data and an isolated development environment. Do not use production credentials/data for convenience.
4. Implement the smallest complete behavior, including authorization and failure states.
5. Add appropriate tests and run the checks applicable to changed code and its dependents.
6. Update API/schema docs, ADRs and release instructions when contracts or architecture change.
7. Review the diff for credentials, private data, generated output and unrelated changes.
8. Open a PR with a clear problem/behavior description, validation results and rollout limitations.

The initial documentation bootstrap is a one-time first commit. The future default is PR review into protected `main`. Follow explicit user authorization for commit/push/deploy actions; permission to edit or commit is not permission to deploy production.

## Review checklist

- Is the behavior consistent with consumer-first scope and does the core loop work with B2B disabled?
- Does every operation enforce current resource/tenant permissions?
- Do database constraints and transactions protect concurrent requests?
- Are retries and external effects safe under duplicates and uncertain outcomes?
- Can a supported older mobile client still use the API?
- Are error, offline, stale and accessibility states clear?
- Are tests meaningful and executed, with material limitations recorded?
- Are secrets and sensitive data excluded from code, logs, notifications and artifacts?
- Are migration and deployment steps compatible and independently recoverable?
- Do shared API changes support separately released mobile and B2B clients without simultaneous merges?

## Documentation changes

Use relative links between files, fenced code blocks with language labels, and readable Mermaid diagrams. Label examples, proposed paths and unimplemented commands. Cite authoritative platform references near claims. Avoid embedding credentials, private project details, unverified pricing or patient research in public docs.

Validate Markdown links and formatting. Check that code examples and state names agree across documents. Do not claim executable CI or security protections exist merely because they are described.

## Reporting issues

Include reproduction, expected/actual behavior, affected app/build and safe diagnostic ids. Use synthetic examples. Report security-sensitive details privately through a repository-owner-approved channel; do not include rider details or credentials in public issues. A formal security contact/disclosure policy must be established before launch.

See [engineering standards](docs/09-engineering-standards.md), [test strategy](docs/07-testing-strategy.md), and [CI/CD](docs/08-cicd-and-environments.md) for implementation requirements.
