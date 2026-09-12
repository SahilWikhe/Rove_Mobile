# Continuous integration and dependency safety

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

## Current pipeline

`.github/workflows/ci.yml` runs on pull requests, pushes to main, merge queues, manual dispatch and a weekly schedule. All suites run for every change while this repository is small. This deliberately avoids path filters silently skipping shared-contract or workflow regressions.

- `quality`: frozen dependency install, peer compatibility, formatting, ESLint/React hooks, package import boundaries, tooling regression tests, all workspace types, Markdown and migration snapshot drift.
- `tests`: behavior and concurrency suites against disposable local PostgreSQL, without cloud credentials or production data.
- `browser`: serial Playwright journeys across both Expo web apps and disposable PostgreSQL, with simulated external providers.
- `infrastructure`: CloudFormation template lint, without AWS credentials or deployment.
- `mobile`: Expo dependency alignment and rider/driver exports for iOS, Android and web.
- `native-android`: rider and driver debug and release binaries compiled for x86_64 on Ubuntu with Java 21. The release APK must contain a nonempty JavaScript bundle.
- `native-ios`: rider and driver unsigned debug and release simulator binaries compiled on macOS 26. The release app must contain a nonempty JavaScript bundle. Both native jobs regenerate projects from Expo config and the frozen patched dependencies; no provider keys or signing credentials are used.
- `security`: moderate-or-higher dependency audit and a redacted full-history secret scan.
- `codeql`: JavaScript/TypeScript and Actions security analysis. The local SARIF gate rejects security findings with severity at least 4 and error-level findings.
- `ci-gate`: requires every preceding job to succeed. Missing, skipped, cancelled or failed jobs fail the gate.

After the workflow has reported successfully, repository administrators can require `ci-gate` in the main-branch ruleset. Adding a workflow alone does not configure branch protection. The workflow does not deploy, migrate a cloud database, use distribution signing or use provider credentials. Android release builds use the generated local test signing configuration; they are not store artifacts. Release bundle checks catch missing embedded JavaScript, but do not prove startup or authenticated native journeys.

## Toolchain and supply chain

Node and pnpm versions are pinned. TypeScript 6.0.3 is intentionally used because the selected typescript-eslint parser supports versions below 6.1; adopting TypeScript 7 requires a compatible parser first. Actions are pinned to immutable commit SHAs. The Gitleaks installer verifies the release binary checksum before execution. Workflow tokens default to read-only contents; only CodeQL receives security-event upload permission.

Scoped transitive overrides address these advisories without changing the Expo SDK:

- `@esbuild-kit/core-utils > esbuild` 0.25.12: [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
- `xcode > uuid` 11.1.1: [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
- `query-string > decode-uri-component` 0.5.0: [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr).

The committed pnpm patch makes query-string 7 consume the decoder's ESM default export. Regression tests cover normal Unicode, malformed inputs with a subprocess timeout, and the Xcode UUID API. Remove overrides and the patch when upstream dependencies incorporate compatible fixes; do not remove them solely to quiet install output.

Dependabot groups routine minor/patch JavaScript updates and Actions updates weekly, with small open-PR limits. Native framework and TypeScript major/minor upgrades require coordinated review. Security updates are not disabled and no automatic merge is configured.

## Evidence and limits

The executable workflow is the source of truth for jobs; [implementation status](18-implementation-status.md) records exact-SHA results. Test totals below are historical checkpoint counts, not today's suite inventory. Use `pnpm test:e2e --list` for browser inventory and inspect a completed CI run for its actual results.

Native jobs compile debug and standalone release simulator/emulator binaries for both roles. They do not boot a physical device, log into Auth0 or perform a Stripe payment. Manual [staging provider checks](staging-provider-ci.md) call real providers but are not full native E2E. A clean scan or export is limited evidence, not a security or release certification.

## September 9 dependency gate repair

CI run `34443714671` failed in `security` and `mobile`: the documentation linter pinned vulnerable `smol-toml@1.7.0`, and Expo's compatibility metadata required newer SDK 57 patches. Tests, browser, quality and CodeQL passed on that run; the aggregate gate correctly failed.

Both apps and shared mobile-core now require Expo `~57.0.21`, with app routers at `~57.0.20`. The lockfile records the matching patch dependencies. A narrowly scoped `markdownlint-cli2>smol-toml: 1.7.1` override fixes [GHSA-7w5x-hrqm-74c2](https://github.com/advisories/GHSA-7w5x-hrqm-74c2) while preserving the current linter. Remove the override once a deliberately upgraded linter depends on a patched parser itself. No advisory exclusions, severity reductions or compatibility-check bypasses were added.

Local verification passed: workspace typechecks and tests, both Expo compatibility checks, both apps' iOS/Android/web exports, dependency audit, peer validation and formatting. All ten browser journeys and frozen-lockfile installation also passed. Native exports are compilation evidence, not physical-device tests. Deployment remains separately gated.
