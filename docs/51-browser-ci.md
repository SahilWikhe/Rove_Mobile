# Browser journey checks in CI

The `browser` GitHub Actions job runs Playwright Chromium against the rider and driver Expo web apps and the real synthetic API with disposable PostgreSQL. It runs on the same PR, main push, merge-group, manual and scheduled triggers as the existing workflow and is required by `ci-gate`. No cloud credentials or production data are used.

## Running locally

With the repository's Node/pnpm versions and dependencies installed:

1. Run `pnpm exec playwright install chromium` once.
2. Run `pnpm test:e2e`.

The runner starts an isolated API on 4085 and Expo web apps on 8091/8092. It refuses to reuse processes occupying those ports, so it cannot silently test an unrelated running app. Your normal local API on 4080 and app previews on 8081/8082 remain separate. All tests run sequentially against one fresh database; each app has its own synthetic account. Tests are not retried automatically.

The synthetic API recognizes `ROVE_E2E=1` only in its local entrypoint, which already refuses production/Vercel execution. That mode permits only the test web origins and exposes a loopback cleanup endpoint used by global teardown. Teardown drains background work and closes PostgreSQL before Playwright signals process groups, avoiding open-connection shutdown errors. This endpoint is absent from the production API.

## Current coverage and limits

Both app tests navigate through sign-in and Account to Help & support, load an empty history, verify a short/empty request cannot be submitted, save a synthetic request, navigate away and back, and resubmit identical content. A real authenticated API read then proves only one open request exists for that app's account. No API response mocks are used.

These tests run at 390×844 using the shared web implementation. They do not prove native iOS/Android behavior, physical-device location, provider sign-in, Stripe payments, push delivery or the complete ride lifecycle. Existing unit/API/database tests and native export checks remain separate requirements. Extend this suite with booking, driver acceptance and trip recovery flows; do not treat two support journeys as full product acceptance.

Playwright retains local failure traces/screenshots in ignored test output directories. Only synthetic data belongs in this suite. The test/config files are included in the root typecheck; CI gate regression tests include the browser job automatically. Linux CI installs Chromium system dependencies before running tests. Workflow logs report test failures; no automatic upload of traces or credentials is configured.

The runner uses Playwright's [managed web-server lifecycle](https://playwright.dev/docs/test-webserver). The first local run found a database shutdown race; after adding explicit teardown, both journeys passed with clean database shutdown.

The preceding queue commit's secret scan flagged ordinary documentation prose. The wording was changed and an exact historical fingerprint was recorded in `.gitleaksignore`; no path or detection rule was disabled. The full-history scanner was rerun after this correction.
