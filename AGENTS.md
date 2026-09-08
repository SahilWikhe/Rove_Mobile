# Coding-agent instructions

## Repository purpose

This is the Rove product monorepo. The marketing website lives in a different repository. Begin with [README.md](README.md) and the relevant documents in `docs/`. This repository contains plans and an in-progress implementation. Consult docs/18-implementation-status.md; do not report applications, checks or infrastructure as implemented until evidence exists.

Current scope: Rove is consumer ride-hailing with automatic matching, online drivers and consumer payments. The institution-facing B2B dashboard is an optional separate-repository product, not the default operating model. `Rove_Mobile` owns both mobile apps, the shared ride backend/database and server-side staff permissions/use cases. The internal staff dashboard lives in its own repository; the institutional dashboard lives in a third product repository. Neither dashboard source belongs here. Do not reinstate the superseded care-first/manual-dispatch assumptions from historical research.

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
- Consumer signup/booking/matching/payment must work without organization membership or a B2B deployment. Keep institution access scoped to explicitly associated rides, never a member's full personal history.
- Share versioned API contracts across product repositories; do not share database credentials, duplicate ride/payment mutations or create cross-repository filesystem imports.

## Status updates before commits and pushes

For every commit or push, update `docs/18-implementation-status.md` with the current checkpoint, work completed, verification actually executed, outstanding blockers and the next concrete step. Update affected setup/runbook documents in the same commit. Distinguish local implementation, cloud resource creation and verified deployment; never imply one proves another. Record push confirmation in the user-facing result after verifying the remote commit; do not claim a pending push succeeded in committed documentation.

## Completion evidence

Describe the outcome, affected behavior, executed verification and material limitations. Link the commit/PR or artifact when created. An architecture document is not proof of deployed security or production readiness.

## Mobile design source of truth

Read [design contract](docs/16-mobile-design-contract.md) before mobile UI work and [scheduling flags](docs/17-scheduling-feature-flags.md) before scheduling work. Preserve Figma theme/layouts except documented overrides. Do not restore default NEMT coverage, Rove Pro, $199/month or 100%-fare claims from mockups. New screens must reuse the design language. Pre-acceptance driver DTOs must exclude precise endpoints, rider identity and medical/payer data. Scheduling defaults off on both API and UI; disabling creation must preserve existing commitments and cancellation paths.
