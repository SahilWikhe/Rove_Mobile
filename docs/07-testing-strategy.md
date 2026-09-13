# Testing strategy and acceptance evidence

Status: executable workspace, browser, tooling, native compilation and standalone welcome/relaunch checks exist; hosted smoke acceptance is tracked separately in the implementation ledger. See [CI inventory](21-ci-verification.md), [browser journeys](51-browser-ci.md) and [manual provider checks](staging-provider-ci.md). The scenario matrix below includes remaining acceptance requirements, not a claim that every scenario is covered. Never count skipped or empty suites as evidence.

## Principles

Test observable behavior and failure recovery. Prefer real database integration tests for database guarantees, focused unit tests for pure policy, and a small set of valuable end-to-end flows. Mock unreliable third-party boundaries in deterministic CI, but validate the real integration in provider sandbox environments before release.

A bug fix includes a regression test where repeatable. Tests must fail for the behavior they protect: changing a permission, allowing a duplicate settlement, or weakening a uniqueness constraint should be detectable. Avoid tests that simply restate implementation constants, massive snapshots, or mocks that pretend the database enforces a constraint it does not have.

## Test toolchain and acceptance requirements

| Layer | Tool / environment | Coverage |
| --- | --- | --- |
| Static | TypeScript strict, ESLint, formatting, dependency graph check | Invalid types, unsafe patterns, forbidden imports |
| Domain | Vitest | Implemented transitions, eligibility, financial and concurrency behavior; recurrence remains future scope |
| Native components | Controller tests plus simulator/manual inspection | Full rendered accessibility/physical-device suite remains unfinished; Jest/RNTL is not an installed CI suite |
| Web components (dashboard repositories) | Vitest + React Testing Library | Operator interactions and accessibility |
| Database/API | Vitest + disposable PostgreSQL | Real constraints, transactions, authorization, migrations |
| Core web end to end | Playwright + both Expo web apps + local PostgreSQL | Booking, trips, recovery, settings and messaging; providers simulated |
| Mobile end to end | Maestro on iOS/Android builds | Rider and driver journey and deep links |
| Device field tests | Physical iPhone + representative Android devices | GPS, battery, termination, permissions and in-app navigation |
| Security | Secret scan, dependency audit/review, CodeQL where available | Leaked credentials and vulnerable/unsafe dependencies/code |

Use a PostgreSQL service container with matching major version/extensions for unprivileged CI. Add a Neon-specific integration lane against an isolated synthetic branch for trusted runs to verify connection/pooling behavior; local Postgres alone does not validate Neon configuration. External provider credentials are never required to run core tests.

## Minimum scenario matrix

Core release gates cover on-demand consumer booking without organization rows, sponsor configuration or a B2B frontend. Caregiver, recurrence, return-readiness and sponsored-balance cases below become mandatory for the corresponding extension before it ships, not prerequisites for building the consumer MVP.

| Area | Required cases | Best test layer |
| --- | --- | --- |
| Identity | Invalid signature/issuer/audience/expiry; disabled user; role escalation | API integration |
| Core independence | Consumer signup/quote/match/trip/payment with all B2B features disabled | API + E2E |
| Quotes | Ownership, expiry, route change, replay, server-owned final price policy | Domain + API |
| Driver availability | Online/offline, stale heartbeat, revoked eligibility, two active devices | API + database |
| Matching | No candidates, decline, expired offer, worker restart, bounded deadline, late push | Domain + integration |
| Acceptance races | Same driver accepts two rides; cancellation races accept; offer superseded | Concurrent database tests |
| Consumer payment | Token ownership, failed hold, no-driver hold release, capture/retry/refund, payable exactly once | Provider sandbox + integration |
| Tenant boundaries | Cross-tenant ids, list filters, exports, admin proxy | API + database |
| Caregiver access | Partial capability; expired/revoked grant; cached/deep-linked access | API + native |
| Scheduling | Weekdays, date bounds, DST gap/overlap, leap date, exception, repeated generation | Domain + database |
| Schedule edits | One occurrence vs future series; already-started leg; duplicate generator | Integration |
| Driver assignment | Two operators assign one ride; one driver offered overlapping work; expired credential | Concurrent database tests |
| Driver acceptance | Offer expires/replaced between screen load and tap | API + native |
| Ride lifecycle | Every allowed edge and forbidden edge; version conflict; repeated transition | Domain + API |
| Return readiness | Duplicate ready signal; no assigned return; outbound cancelled; overdue pickup | Domain + E2E |
| Location | Sequence reorder, stale epoch, reassignment, future time, accuracy/coordinate limits | API + device |
| Offline | Pending milestone, retry with same key, revoked assignment, expired queue | Native + API + device |
| Notifications | Duplicate event, cancellation before delivery, invalid token, provider timeout | Integration |
| Outbox | Crash before/after provider handoff, lease expiry, retry exhaustion and replay | Integration/fault injection |
| Funding | Concurrent reservation against last balance; release; cap exceeded; currency validation | Concurrent database tests |
| Settlement | Duplicate completion/callback; unknown provider outcome; reversal; ledger balance | Integration/property tests |
| Webhooks | Invalid raw-body signature; replay; duplicate/out-of-order events | API integration |
| Privacy | No sensitive push/log/error fields; unauthorized signed URL; logout cleanup | Contract + integration |
| Schema | Empty bootstrap, upgrade from previous schema, resumable backfill | Database integration |
| Compatibility | Supported prior client requests/responses and unknown display state | Contract fixtures |
| Accessibility | Large text, screen reader labels, keyboard focus, reduced motion and contrast | Component + E2E + manual |
| B2B boundary | Customer admin is not Rove staff; organization cannot see member's personal trips | API + separate dashboard E2E |
| Cross-repo compatibility | Pinned internal/B2B clients against candidate core API; dashboard outages during active ride | Contract + trusted integration |

For race tests, coordinate two independent database connections with a barrier so they actually contend. Assert final rows, event counts and financial totals, not just HTTP response codes. Run these repeatedly in a dedicated lane if necessary to expose serialization errors, but do not hide flaky results with blanket retries.

## Fixtures and test isolation

Use builders with explicit rider, driver, market, availability and clock contexts. Core fixtures create no organization. Extension access tests seed two institutions and users with both personal/sponsored trips to prove isolation. Use synthetic names, addresses and provider ids; no production backups or exported patient data.

Give each worker a unique database/schema or rollback-isolated fixture strategy compatible with parallel requests. Clean up disposable Neon branches on success, failure and timeout, and run an orphan cleanup job with a TTL. Tests should not depend on order, current time, network geocoding or randomly selected fares.

Inject clock and identifier/provider interfaces where behavior needs determinism. Test a timezone-aware clock at scheduling boundaries. Contract fixtures are versioned with the API and include the oldest supported mobile contract, not just today's generated types.

## Coverage policy

Proposed coverage targets (not enforced percentage gates in current CI): 90% line and branch coverage for pure scheduling, permission, ride-state and financial-policy modules; 80% for other testable application logic. Review thresholds after the first complete feature establishes a meaningful baseline. Thresholds supplement, rather than replace, the scenario matrix and concurrency tests.

Exclude generated clients, declarations and platform-generated code with documented patterns. Do not exclude difficult business rules to make a number pass. A focused exemption needs a reason and follow-up test plan. Changed security/financial behavior always requires explicit tests even when aggregate coverage is high.

## CI tiers

- **Every PR:** formatting/docs, types, lint, boundaries, relevant unit/component suites, API/database integration for affected backend paths, migration checks when applicable, contract compatibility, security scans and affected build checks.
- **Trusted integration PR or explicit run:** sandbox provider smoke, isolated Neon driver/pooling test, browser E2E and native build/E2E according to affected paths.
- **Nightly:** full dependency graph, full API/database suite, scheduled security scans and device-emulator flows within budget.
- **Release candidate:** both platform builds, complete quote -> automatic match -> trip -> payment loop, ownership/security regression, real-device online/trip tracking, matching timeout/worker recovery, migration/rollback and sandbox financial reconciliation. The core loop must pass with B2B disabled.

Each dashboard repository owns its component/session/browser E2E tests. This repository retains staff authorization, driver approval, operational mutation/audit tests and optional organization API/policy tests. Test that a normal ride completes while either dashboard UI is unavailable, and that institution identities cannot invoke staff endpoints. Internal-dashboard releases require staff MFA, role revocation, CSRF/session, support and finance flow evidence against a compatible synthetic API. Contract distribution/consumer checks cover separately released versions. A dashboard-only change need not build mobile binaries, but an incompatible shared API change cannot be waved through because its frontend is in another repository.

Native builds can be slower or paid. Optimize with path/dependency impact detection, but a change to Expo configuration, shared native code, authentication, location, native plugins or dependencies must get appropriate iOS and Android build evidence before release. Do not make pure Markdown edits wait for app-store builds.

## Definition of tested

Record commit, environment, tool versions, executed suites, results and material limitations. A website health check is not a mobile background-tracking test. A provider sandbox test is not proof of production account permissions. A locally mocked payment cannot validate processor settlement behavior.

Store traces/screenshots with bounded retention and synthetic data; redact credentials and URLs containing tokens. Assign an owner and short deadline to flaky-test quarantine. A quarantined critical test requires replacement evidence before release.

## Design-contract and scheduling acceptance

Add the frame/state tests in [mobile design contract](16-mobile-design-contract.md): consumer quote/payment, no-driver and cancellation recovery, pending financial results, onboarding/eligibility and driver arrival → start → completion. Assert no Pro subscription or default sponsored coverage in the core experience. Test pre-acceptance sensitive-field absence in actual serialized offer/map/push data, then assignment grant/revocation. Compare native screenshots and accessibility at supported sizes.

Implement all scheduling flag combinations and rollback/provider-failure tests in [flag plan](17-scheduling-feature-flags.md), including weekly/monthly date boundaries, crafted API requests and already accepted schedule continuation. A disabled scheduling module must not block the on-demand core suite.

## Driver UI state in recovery checks

Storage-recovery browser tests wait for the Account navigation control after sign-in, which exists in both offline and online driver layouts. The offline header's Open your account button is not a session-readiness signal. Preserve the existing online state when checking recovery; do not force drivers offline or relax the no-automatic-mutation assertions to make the test pass.

## Current local regression checkpoint — September 12

On source `3097f62`, the complete 57-journey browser suite passed in 5.2 minutes using isolated synthetic services. Workspace typechecks, configured test tasks (including 648 server tests), lint, formatting and package-boundary checks passed. Browser coverage includes real local persistence/lifecycle and simulated provider responses; it does not prove physical-device scheduling, actual push delivery, production payments or complete hosted-provider acceptance. See docs/18-implementation-status.md for remaining release gaps and separate native evidence.
