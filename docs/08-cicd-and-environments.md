# CI/CD, environments, and release controls

Status: CI is implemented and verified on GitHub runners; see [current pipeline](21-ci-verification.md). Staging Git deployment and native compile matrix jobs are implemented; controlled production promotion, store release and physical-device E2E remain unfinished. No production release is implied.

## Environment topology

| Environment | Database/data | Identity and providers | Deployment |
| --- | --- | --- | --- |
| Local | Local Postgres or isolated Neon development branch; synthetic | Test identities, mocks/sandbox | Local API/admin, Expo development build |
| PR preview | Disposable branch from clean synthetic seed | Test-only credentials and message sinks | Protected Vercel previews; optional mobile preview build |
| Staging | Persistent synthetic integration dataset | Sandbox payments/maps quotas; test identities | Stable staging API/admin and internal mobile builds |
| Production | Separate controlled production Neon project | Production identity/provider credentials | Controlled Vercel release and store builds |

Use separate production and nonproduction Neon projects before real data is introduced. Branching from production can copy sensitive data; PR branches must derive from a synthetic seed or a validated schema-only workflow. A branch named `production` does not by itself establish whether it contains real data or has production controls.

Existing setup fact: Neon was linked in the local research folder, with `defineConfig({})`, to a branch named `production`. Application bootstrap must inspect the project's purpose/region and establish correct environment links in this new checkout. Never copy all of the research folder or blindly apply migrations through its existing credentials. Resource ids and connection strings are not needed in the public architecture.

## Vercel and Expo projects

The deployed staging project is `rove-api-staging`, rooted at `apps/api` in `Rove_Mobile`; see [staging configuration](61-vercel-staging.md). The proposed `rove-ops` Vercel project connects to the separate internal-dashboard repository (name and root path TBD), not a workspace in this repository. The institutional dashboard uses another project connected to its separate repository (name TBD), only when that add-on is built. Core workspace/build settings exist. The API/queue region is `iad1`; Neon staging is AWS US East 2, so the regions differ and latency must be measured. Marketing retains its own repository/project. References to admin below mean the internal staff surface unless explicitly labeled B2B.

Create separate Expo projects for rider and driver. Each has development, preview/staging and production build profiles, app identifiers, update channels and signing credentials. API base URLs are explicit per build environment. Store releases are independent from API deployment; a GitHub merge does not automatically install a new mobile binary on users' devices. [Expo monorepo builds](https://docs.expo.dev/build-reference/build-with-monorepos/)

## Workflow inventory

| Workflow | Trigger | Implemented scope |
| --- | --- | --- |
| `.github/workflows/ci.yml` | PR, main push, merge group, manual, weekly | Quality, tests, browser, mobile exports, four native compile/standalone launch jobs, infrastructure lint, security, CodeQL and aggregate gate |
| `.github/workflows/staging-providers.yml` | Manual main dispatch with billing acknowledgement | Real provider health/configuration and bounded Maps requests; no login/payment transaction |
| `.github/workflows/release-readiness.yml` | Manual main dispatch | Read-only exact-SHA CI/provider evidence collection; no promotion or deployment |
| Vercel Git integration | Main push | Staging deployment, independent of CI completion |

Production promotion, preview acceptance automation and store submission workflows remain planned. `pnpm release:check` validates evidence for a specific SHA; it does not deploy anything. Require only existing checks, and verify effective branch/environment protections separately.

## Required gate without skipped-check traps

Future optimization: an always-running change-detection job computes the changed packages and transitive dependents from the true PR base/head with adequate Git history. Root lockfile, compiler, lint, build, test or workflow changes must invalidate all relevant consumers. If the base cannot be resolved, run the full suite.

Conditional jobs may skip when irrelevant. An always-running `ci-gate` aggregates results, knows which jobs were required, and fails on failed, cancelled or unexpectedly skipped required work. Do not put the entire required workflow behind a path filter. Test the gate itself with documentation-only, mobile-only, shared-package, migration and root-lockfile changes.

Caching is an optimization only. Include lockfile, toolchain, task inputs, relevant public configuration and dependency outputs in cache keys. Never cache secrets, `.env`, database dumps or private artifacts. Disable caching for migrations, provider side effects and environment-dependent integration tests. Forks cannot write trusted remote cache or receive remote-cache credentials.

## CI security

Use `pull_request` for untrusted code and a read-only default GitHub token. Pin third-party actions to reviewed full commit SHAs and track updates through grouped dependency PRs. Treat titles, branch names and changed file contents as untrusted strings, never interpolated shell code.

Do not combine untrusted checkout with privileged `pull_request_target` or `workflow_run` jobs. Provider credentials and write-capable database access belong only in trusted isolated jobs with explicit environment restrictions. Prefer scoped/OIDC credentials where supported, otherwise scoped rotated secrets. [GitHub secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use)

Allow fork PRs to run safe tests using local Postgres and mocks. Preview code with access to secrets can exfiltrate them, so a trusted preview is still restricted to disposable test accounts/data. No production API, database or signing secrets enter a preview build.

## Branch policy

All three product repositories own their workflows, protections and release authorization. Neither dashboard CI receives core database or migration credentials. Publish a versioned OpenAPI/client artifact from the core repository and pin its version in each dashboard; workspace change detection does not cross repository boundaries. Trusted compatibility runs pair a candidate API with supported released client versions and synthetic data. See [B2B boundary](14-b2b-product-boundary.md).

After the initial documentation bootstrap, develop on short-lived feature branches and use PRs into `main`. Protect `main` against deletion and force pushes, require PRs and the real `ci-gate`, and require current-base validation (or a correctly configured merge queue). Require review when another qualified reviewer is available; do not set an impossible self-approval requirement for a sole maintainer.

Use an additional deployment check only after it reliably reports for the corresponding preview. Do not require a production deployment before merge. Workflow enforcement and available security features depend on repository visibility and account plan; verify actual settings rather than claiming this document enables them.

Group routine dependency updates weekly by ecosystem, keep major upgrades separate, and allow urgent security updates promptly. Cap routine open update PRs to limit noise. Never auto-merge solely because a dependency bot opened the PR.

## Backend/admin release ordering

For the product, prefer explicit production promotion from a tested commit. Configure Vercel's Git/production deployment behavior to match that policy; its default integration may deploy `main` automatically and is not inherently gated by GitHub Actions. Verify the effective behavior before enabling production domains. Do not assume branch protection alone sequences a migration and a deployment.

1. Select a release SHA whose required checks and staging acceptance passed.
2. Serialize the release per environment; confirm no competing migration/release is running.
3. Review and apply compatible expansion migrations with a dedicated migration role.
4. Deploy the API artifact with the recorded schema compatibility range.
5. Smoke-test readiness, authenticated synthetic canary operations and critical safe reads without altering real rides.
6. Deploy the internal ops interface through its own repository’s release workflow when its required API is available; an API release need not redeploy it if the existing version stays compatible. The optional B2B frontend follows its own release process against a compatible API and is not required for a core release.
7. Observe errors, latency, jobs and database health; then authorize any staged feature exposure.
8. Apply destructive contract migrations only in a later release after compatibility windows close.

Never migrate from a Vercel build hook. Builds can happen concurrently for multiple projects and previews. Roll back code only to a version compatible with the current schema. For data faults, stop affected operations and use a reviewed forward repair or controlled restore runbook.

Core release smoke covers a synthetic consumer quote, online driver, timed offer, acceptance, trip and sandbox payment with organization features disabled. When B2B ships, separately test accepted sponsored-trip continuation during a dashboard outage and isolation of bulk reporting/booking load. Neither dashboard repository nor its web proxy applies core schema migrations. Verify the supported internal-dashboard client against the candidate API and prove normal rides continue during a staff UI outage. Staff tools remain a pilot-readiness requirement, with an outage escalation procedure.

## Mobile releases

Use internal distribution/TestFlight/Play testing before public releases. Record application version, native build number, Expo runtime version, channel, API contract compatibility and Git SHA. New native dependencies, permissions or native configuration require a new binary. OTA updates, if enabled later, must match native runtime compatibility and have their own tested rollout/rollback policy; they are not a way around store policy.

Keep signing keys in the build platform's protected credentials management. Public configuration is part of the bundle; database or payment secrets must never be present. Production submission is an explicit release action, not a side effect of every PR or merge.

## Working commands

The root package supplies `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm tooling:test`, `pnpm boundaries:check`, `pnpm docs:check` and `pnpm build:mobile`. API package build/smoke and native compilation run separately in CI. There are no root `test:unit`, `test:integration`, `test:contracts` or `test:e2e:mobile` scripts; do not copy the old proposed names into automation.

`pnpm release:check`, `pnpm production:preflight` and `pnpm db:production:migrate` exist, with explicit environment/evidence inputs described in [production setup](production-setup.md) and [migrations](production-migrations.md). These commands do not create production infrastructure or a full release pipeline.

## Feature flag release controls

Default scheduling flags off in each environment. Core CI uses deterministic fake evaluation and tests the full prerequisite matrix; trusted staging validates the Vercel/Hono adapter. Record flag changes separately from code deployments, limit management access and review impact before enabling cohorts. Never copy production targeting or provider keys into untrusted previews. Already accepted scheduling commitments survive flag rollback and normal API compatibility rules apply to older apps. See [flag plan](17-scheduling-feature-flags.md).

## Hosted runner billing prerequisite — September 12

CI run `34708488268` at `ad16b3c` failed before any job started. GitHub reports failed recent account payments or a spending limit requiring attention in account Billing & plans. The owner must resolve the reported account condition before rerunning CI for the intended candidate. This is separate from the private-repository CodeQL entitlement prerequisite; neither is bypassed by local tests or a successful Git push.
