# SonarQube Cloud analysis

## Workflow

`.github/workflows/sonarqube.yml` adds a separate SonarQube analysis check for pushes to main and same-repository pull requests. Manual runs are also available. It uses the official scanner pinned to v8.2.1's commit, full Git history and the repository's locked dependencies. The scanner waits up to five minutes for the project's quality gate and fails if that gate fails. This does not automatically change branch-protection requirements.

Fork and Dependabot pull requests do not receive the scan credential; existing CI continues to test those changes. Automatic scans activate once SONAR_PROJECT_KEY is configured. A skipped scan is not successful analysis. A manual run fails with setup instructions when required settings are missing.

Authored app, shared package, backend, migration, tooling and workflow sources are included. Test files are classified separately; dependency/build output and generated Drizzle snapshots are excluded. Existing unit/integration tests remain in CI. The scanner now runs pnpm test:coverage first. The six packages with Vitest suites generate V8 LCOV reports with repository-relative paths through vitest.coverage.config.ts. Reports include unexecuted source files in those packages; SonarQube retains its normal coverage requirements. These tests use disposable local PostgreSQL and synthetic provider adapters, without cloud secrets. Coverage integration is being verified; no passing coverage gate is claimed yet.

## Connect the linked project

Open SonarQube Cloud, choose Projects, select Rove_Mobile and copy the project page URL. Project Information shows its project key; the organization page/settings show its organization key. Use keys rather than display names.

In GitHub repository Settings → Secrets and variables → Actions, configure:

- Secret SONAR_TOKEN: a SonarQube analysis token with access to this project. Paste it directly into GitHub, never into chat or a committed file.
- Variable SONAR_PROJECT_KEY: the linked project's exact key.
- Variable SONAR_ORGANIZATION: its organization key.
- Optional variable SONAR_HOST_URL: the instance URL; defaults to `https://sonarcloud.io`. Confirm regional or self-hosted setup before overriding it.

If SonarQube Cloud Automatic Analysis is enabled, turn it off in the project's Administration → Analysis Method before activating CI-based analysis. Then run the SonarQube workflow manually and confirm that the analysis appears on the intended project and the GitHub quality-gate check completes. Only then consider making the check required for merging.

## Verification status

The workflow is published on main. YAML parsing, official actionlint v1.7.12, formatting and documentation checks passed. Project SahilWikhe_Rove_Mobile / organization sahilwikhe and matching GitHub variables were verified. SONAR_TOKEN was saved without exposing its value. Attempt 1 authenticated but hit an Automatic Analysis conflict; the user disabled that setting. Attempt 2 of [run 34768505120](https://github.com/SahilWikhe/Rove_Mobile/actions/runs/34768505120) completed analysis and failed only the new-code coverage condition: 0% against 80%, because no LCOV report was supplied. Reliability, security, maintainability, duplication and hotspot-review gate conditions passed. V8 coverage reporting passed in all six local suites (11 successful Turbo tasks including dependency typechecks), with server line coverage of 92.26% and repository-relative LCOV paths verified. Its hosted gate result remains pending. SQL parser warnings on PostgreSQL migration syntax mean the scan is not complete SQL validation; the actual migration and restricted-role database tests remain authoritative. The scan is not a substitute for native-device or real-provider acceptance checks.

References: [official scanner action](https://github.com/SonarSource/sonarqube-scan-action), [GitHub Actions setup](https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/ci-based-analysis/github-actions-for-sonarcloud), [JavaScript/TypeScript coverage](https://docs.sonarsource.com/sonarqube-cloud/enriching/test-coverage/javascript-typescript-test-coverage).
