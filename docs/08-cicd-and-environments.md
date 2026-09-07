# CI/CD, environments, and release controls

Status: deployment blueprint. No Vercel project, EAS project, GitHub workflow or production release is created by this documentation commit.

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

Plan Vercel projects `rove-api` rooted at `apps/api` and `rove-admin` rooted at `apps/admin`. Configure monorepo shared-package access and verified workspace build commands after the source exists. Use the Ohio function region with the Ohio database unless an ADR changes that choice. The existing marketing website retains its own project and repository.

Create separate Expo projects for rider and driver. Each has development, preview/staging and production build profiles, app identifiers, update channels and signing credentials. API base URLs are explicit per build environment. Store releases are independent from API deployment; a GitHub merge does not automatically install a new mobile binary on users' devices. [Expo monorepo builds](https://docs.expo.dev/build-reference/build-with-monorepos/)

## Proposed workflow inventory

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci` | PR, push to main, merge group if enabled | Always-visible quality gate, affected test/build jobs |
| `security` | PR and schedule | Secrets, dependencies, code scanning as supported |
| `preview-smoke` | Trusted preview ready | Authenticate preview, verify API/admin critical routes and isolation |
| `native-validation` | Relevant PR/manual run | iOS/Android build and selected mobile E2E |
| `release` | Explicit authorized dispatch/tag | Pin tested SHA, migrate, release backend/admin and smoke |
| `mobile-release` | Explicit authorized dispatch | Store/internal builds and submission as separately configured |
| `maintenance` | Schedule/manual | Full suite, disposable resource cleanup, dependency updates |

These are proposed names. Add required status checks only after actual jobs exist and have reported. Do not configure fictitious required checks that permanently block merges.

## Required gate without skipped-check traps

An always-running change-detection job computes the changed packages and transitive dependents from the true PR base/head with adequate Git history. Root lockfile, compiler, lint, build, test or workflow changes must invalidate all relevant consumers. If the base cannot be resolved, run the full suite.

Conditional jobs may skip when irrelevant. An always-running `ci-gate` aggregates results, knows which jobs were required, and fails on failed, cancelled or unexpectedly skipped required work. Do not put the entire required workflow behind a path filter. Test the gate itself with documentation-only, mobile-only, shared-package, migration and root-lockfile changes.

Caching is an optimization only. Include lockfile, toolchain, task inputs, relevant public configuration and dependency outputs in cache keys. Never cache secrets, `.env`, database dumps or private artifacts. Disable caching for migrations, provider side effects and environment-dependent integration tests. Forks cannot write trusted remote cache or receive remote-cache credentials.

## CI security

Use `pull_request` for untrusted code and a read-only default GitHub token. Pin third-party actions to reviewed full commit SHAs and track updates through grouped dependency PRs. Treat titles, branch names and changed file contents as untrusted strings, never interpolated shell code.

Do not combine untrusted checkout with privileged `pull_request_target` or `workflow_run` jobs. Provider credentials and write-capable database access belong only in trusted isolated jobs with explicit environment restrictions. Prefer scoped/OIDC credentials where supported, otherwise scoped rotated secrets. [GitHub secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use)

Allow fork PRs to run safe tests using local Postgres and mocks. Preview code with access to secrets can exfiltrate them, so a trusted preview is still restricted to disposable test accounts/data. No production API, database or signing secrets enter a preview build.

## Branch policy

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
6. Deploy the admin interface when its required API is available.
7. Observe errors, latency, jobs and database health; then authorize any staged feature exposure.
8. Apply destructive contract migrations only in a later release after compatibility windows close.

Never migrate from a Vercel build hook. Builds can happen concurrently for multiple projects and previews. Roll back code only to a version compatible with the current schema. For data faults, stop affected operations and use a reviewed forward repair or controlled restore runbook.

## Mobile releases

Use internal distribution/TestFlight/Play testing before public releases. Record application version, native build number, Expo runtime version, channel, API contract compatibility and Git SHA. New native dependencies, permissions or native configuration require a new binary. OTA updates, if enabled later, must match native runtime compatibility and have their own tested rollout/rollback policy; they are not a way around store policy.

Keep signing keys in the build platform's protected credentials management. Public configuration is part of the bundle; database or payment secrets must never be present. Production submission is an explicit release action, not a side effect of every PR or merge.

## Future script contract

Foundation will implement `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:contracts`, `pnpm test:e2e:web`, `pnpm test:e2e:mobile`, `pnpm check:boundaries`, `pnpm docs:check` and workspace-specific build/migration commands. Commands must fail when an expected suite/configuration is missing. Mobile E2E commands may require a prepared build/device and must explain that prerequisite clearly.

Do not use these as working commands until the scaffold supplies them. [Vercel monorepo configuration](https://vercel.com/docs/monorepos)
