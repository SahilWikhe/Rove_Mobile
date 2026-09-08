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

These tests run at 390×844 using the shared web implementation. They do not prove native iOS/Android behavior, physical-device location, provider sign-in, Stripe payments or push delivery. Existing unit/API/database tests and native export checks remain separate requirements. The booking cases below extend coverage; this suite is still not full product acceptance.

Playwright retains local failure traces/screenshots in ignored test output directories. Only synthetic data belongs in this suite. The test/config files are included in the root typecheck; CI gate regression tests include the browser job automatically. Linux CI installs Chromium system dependencies before running tests. Workflow logs report test failures; no automatic upload of traces or credentials is configured.

The runner uses Playwright's [managed web-server lifecycle](https://playwright.dev/docs/test-webserver). The first local run found a database shutdown race; after adding explicit teardown, both journeys passed with clean database shutdown.

The preceding queue commit's secret scan flagged ordinary documentation prose. The wording was changed and an exact historical fingerprint was recorded in `.gitleaksignore`; no path or detection rule was disabled. The full-history scanner was rerun after this correction.

## Booking and trip coverage

The suite also exercises:

- Manual pickup/destination search, Standard selection and quote review, followed by a rider request. Cancelling first exposes a confirmation; keeping the ride preserves it, and confirming cancellation persists the cancelled state.
- Two separate app sessions: the driver goes online, the rider requests, the driver receives an offer, accepts, confirms heading to pickup/arrival/start/completion, and the rider sees the completed trip. Before acceptance the UI must not show the exact pickup or rider name. The driver goes offline after completion.
- A lost booking response: Playwright forwards the POST to the real API, waits for its successful commit, then aborts delivery to the browser. The rider's recovery UI checks the original request. API history proves that exactly one new ride exists and its ID matches the original commit. The test then cancels it.

All five journeys run serially against fresh synthetic data without automatic retries. The suite deliberately discards one committed booking response and sends one cancellation with an outdated version. Both cases still reach the real backend; neither replaces its booking or concurrency logic. Polling and normal UI confirmation controls drive trip progress. The local payment provider simulates external authorization/capture without contacting Stripe. The worker now uses the shared payment-session, reconciliation and ledger services. The completed-trip test waits for a real receipt query, opens the receipt screen, checks its paid state and explicit synthetic-payment label, and verifies the captured amount against the server-owned quote. This proves a ledger-backed synthetic receipt, not a real Stripe charge.

Payment authorization can change a ride version while cancellation confirmation is open. On `STALE_RIDE`, the app closes the confirmation, refreshes the ride and asks the rider to review and confirm again. It never automatically retries the cancellation. The first booking test deliberately submits version 1 after authorization advances the ride, verifies the real API returns `409 STALE_RIDE`, checks that the confirmation closes and the ride remains searching, then explicitly confirms again. The cancellation helper also follows this reconfirmation path for naturally occurring version changes.
