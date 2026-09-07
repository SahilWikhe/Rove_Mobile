# Coding-agent instructions

## Repository purpose

This is the Rove product monorepo. The marketing website lives in a different repository. Begin with [README.md](README.md) and the relevant documents in `docs/`. This initial revision contains plans only; do not report applications, checks or infrastructure as implemented until evidence exists.

## Working rules

- Respect the user's current scope and commit/push/deployment instructions. Do not infer production authorization from permission to create a PR or update documentation.
- Preserve unrelated user changes. Confirm repository and environment before editing, linking resources or running database commands.
- Use synthetic data for development and tests. Never print, commit or copy real credentials, `.env` files, patient data or local authentication state into artifacts.
- Keep transport handlers thin and domain rules modular. Follow package boundaries in `docs/02-system-architecture.md`.
- Never import server/database code into mobile or browser bundles. Validate external input and authorize each resource operation on the server.
- Use transactions/constraints for assignment, funding and lifecycle invariants. Do not replace database guarantees with in-memory checks.
- Add regression and behavior tests appropriate to the change. Test permission, retry and concurrency failures when relevant; avoid tests that only mirror implementation.
- Run applicable checks and report what actually ran. Do not bypass required tests, weaken security, or claim success for skipped/missing suites.
- Follow versioned migrations and compatibility rules. Do not run migrations during application startup or normal build steps.
- Keep native platform dependencies aligned with the selected Expo SDK. Test relevant iOS and Android changes.
- Update ADRs and affected docs when a meaningful architecture decision changes. Keep open decisions explicit rather than silently choosing a vendor with material cost/privacy consequences.

## Completion evidence

Describe the outcome, affected behavior, executed verification and material limitations. Link the commit/PR or artifact when created. An architecture document is not proof of deployed security or production readiness.
