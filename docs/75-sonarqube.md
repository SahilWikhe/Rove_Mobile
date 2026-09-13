# SonarQube Cloud analysis

## Workflow

`.github/workflows/sonarqube.yml` adds a separate SonarQube analysis check for pushes to main and same-repository pull requests. Manual runs are also available. It uses the official scanner pinned to v8.2.1's commit, full Git history and the repository's locked dependencies. The scanner waits up to five minutes for the project's quality gate and fails if that gate fails. This does not automatically change branch-protection requirements.

Fork and Dependabot pull requests do not receive the scan credential; existing CI continues to test those changes. Automatic scans activate once SONAR_PROJECT_KEY is configured. A skipped scan is not successful analysis. A manual run fails with setup instructions when required settings are missing.

Authored app, shared package, backend, migration, tooling and workflow sources are included. Test files are classified separately; dependency/build output and generated Drizzle snapshots are excluded. Existing unit/integration tests remain in CI. The scanner runs pnpm test:coverage and pnpm tooling:coverage before analysis. Node tooling tests generate coverage/tooling.lcov, including the spawned proxy; Vitest reports alone do not cover those scripts. The six packages with Vitest suites generate V8 LCOV reports with repository-relative paths through vitest.coverage.config.ts. Reports include unexecuted source files in those packages; SonarQube retains its normal coverage requirements. These tests use disposable local PostgreSQL and synthetic provider adapters, without cloud secrets. The initial Vitest integration passed its hosted gate. The subsequent proxy change exposed missing Node-tooling coverage (72.6% new-code coverage); all 68 tooling tests passed with LCOV generation, and the updated hosted gate remains pending.

## Connect the linked project

Open SonarQube Cloud, choose Projects, select Rove_Mobile and copy the project page URL. Project Information shows its project key; the organization page/settings show its organization key. Use keys rather than display names.

In GitHub repository Settings → Secrets and variables → Actions, configure:

- Secret SONAR_TOKEN: a SonarQube analysis token with access to this project. Paste it directly into GitHub, never into chat or a committed file.
- Variable SONAR_PROJECT_KEY: the linked project's exact key.
- Variable SONAR_ORGANIZATION: its organization key.
- Optional variable SONAR_HOST_URL: the instance URL; defaults to `https://sonarcloud.io`. Confirm regional or self-hosted setup before overriding it.

If SonarQube Cloud Automatic Analysis is enabled, turn it off in the project's Administration → Analysis Method before activating CI-based analysis. Then run the SonarQube workflow manually and confirm that the analysis appears on the intended project and the GitHub quality-gate check completes. Only then consider making the check required for merging.

## Verification status

The workflow is published on main. YAML parsing, official actionlint v1.7.12, formatting and documentation checks passed. Project SahilWikhe_Rove_Mobile / organization sahilwikhe and matching GitHub variables were verified. SONAR_TOKEN was saved without exposing its value. Attempt 1 authenticated but hit an Automatic Analysis conflict; the user disabled that setting. Attempt 2 of [run 34768505120](https://github.com/SahilWikhe/Rove_Mobile/actions/runs/34768505120) completed analysis and failed only the new-code coverage condition: 0% against 80%, because no LCOV report was supplied. Reliability, security, maintainability, duplication and hotspot-review gate conditions passed. V8 coverage reporting passed in all six local suites (11 successful Turbo tasks including dependency typechecks), with server line coverage of 92.26% and repository-relative LCOV paths verified. The subsequent [run 34769028925](https://github.com/SahilWikhe/Rove_Mobile/actions/runs/34769028925) passed on aaa9adbc529a5cb04abbaf2e555f4c257594121e. All six quality-gate conditions passed: new-code coverage 98% against 80%, duplication 0% against 3%, hotspot review 100%, and reliability/security/maintainability ratings A. This measures new code, not whole-app acceptance. SQL parser warnings on PostgreSQL migration syntax mean the scan is not complete SQL validation; the actual migration and restricted-role database tests remain authoritative. The scan is not a substitute for native-device or real-provider acceptance checks.

References: [official scanner action](https://github.com/SonarSource/sonarqube-scan-action), [GitHub Actions setup](https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/ci-based-analysis/github-actions-for-sonarcloud), [JavaScript/TypeScript coverage](https://docs.sonarsource.com/sonarqube-cloud/enriching/test-coverage/javascript-typescript-test-coverage).

## Existing security findings — September 13

Initial authenticated CLI review found 24 open security-impacting findings on main; a subsequent scan cleared the three password findings, leaving 21 at the latest review. The passing new-code gate does not clear this existing backlog. None were marked accepted or false positive during this review.

| Area | Findings | Review state |
| --- | ---: | --- |
| Test PostgreSQL credentials | 3 | Fixed constants replaced with generated per-run credentials. The subsequent authenticated issue list confirms all three password findings cleared. |
| Local realtime proxy | 3 | Forwarding now uses fixed loopback Host, origin-form paths and header allowlists; unexpected redirects are rejected. A local HTTP/WebSocket regression passed for malicious headers/paths and normal forwarding. The next issue inspection no longer listed redirect/prototype findings; SSRF remained open. No manual dismissal. |
| CLI evidence paths | 5 | Environment/evidence reads now enforce canonical containment in the working directory and reject external symlinks, non-regular files and inputs over 1 MiB. Three regression tests passed; scanner confirmation pending. These commands do not write input files. |
| GitHub workflows | 5 | Job-scoped read permissions, script-disabled pinned Vercel installs and HTTPS-only Maestro downloads are implemented. Local CLI startup, actionlint and release tests passed; scanner confirmation pending. |
| Development executable lookup | 6 | Six flagged scripts now use fixed system executables, validated absolute GitHub/Auth0 paths, or the invoking pnpm script. All 70 tooling tests passed; scanner confirmation pending. |
| Realtime retry jitter | 1 | Randomness is used for reconnect timing, not authentication; retain for explicit review. |
| Android emulator address | 1 | The development host alias 10.0.2.2 needs environment-boundary confirmation. |

The password findings concern synthetic fixtures, not known production credentials. The generated database password is retained only in the test fixture for additional test connections; tests continue to use disposable local PostgreSQL. The build verifier retains its explicit child environment and example.test database host. No cloud credentials were read or rotated.

## Maintainability review — September 13

The authenticated issue inventory listed three open maintainability Blockers: two tests without explicit assertions (S2699), and the session expiration helper always returning null (S3516). Tests now assert successful validation/subprocess completion; expiration performs its side effects through a void return contract while token callers preserve null results. All 172 mobile-core tests and 11 targeted Node tests passed, plus typechecking and lint. Scanner closure requires the next analysis; no findings were manually dismissed. Medium findings are deferred per user direction.

## Coverage provider boundaries

Node’s tooling coverage is restricted to .mjs files. Vitest remains responsible for TypeScript application/backend coverage. The prior Node report also included 104 TypeScript files and overlapped the Vitest statement mapping, causing Sonar to count type/signature and multiline-expression lines as uncovered. The corrected tooling command passed all 70 tests and retains realtime proxy coverage. No quality threshold or source-analysis scope was reduced; confirmation awaits the next scan.
