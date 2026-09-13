# SonarQube Cloud analysis

## Workflow

`.github/workflows/sonarqube.yml` adds a separate SonarQube analysis check for pushes to main and same-repository pull requests. Manual runs are also available. It uses the official scanner pinned to v8.2.1's commit, full Git history and the repository's locked dependencies. The scanner waits up to five minutes for the project's quality gate and fails if that gate fails. This does not automatically change branch-protection requirements.

Fork and Dependabot pull requests do not receive the scan credential; existing CI continues to test those changes. Automatic scans activate once SONAR_PROJECT_KEY is configured. A skipped scan is not successful analysis. A manual run fails with setup instructions when required settings are missing.

Authored app, shared package, backend, migration, tooling and workflow sources are included. Test files are classified separately; dependency/build output and generated Drizzle snapshots are excluded. Existing unit/integration tests remain in CI. LCOV coverage is not yet collected or uploaded, so this workflow does not claim coverage measurement. Do not disable coverage requirements to hide that gap; review the first quality-gate result and add coverage reporting if the configured gate requires it.

## Connect the linked project

Open SonarQube Cloud, choose Projects, select Rove_Mobile and copy the project page URL. Project Information shows its project key; the organization page/settings show its organization key. Use keys rather than display names.

In GitHub repository Settings → Secrets and variables → Actions, configure:

- Secret SONAR_TOKEN: a SonarQube analysis token with access to this project. Paste it directly into GitHub, never into chat or a committed file.
- Variable SONAR_PROJECT_KEY: the linked project's exact key.
- Variable SONAR_ORGANIZATION: its organization key.
- Optional variable SONAR_HOST_URL: the instance URL; defaults to `https://sonarcloud.io`. Confirm regional or self-hosted setup before overriding it.

If SonarQube Cloud Automatic Analysis is enabled, turn it off in the project's Administration → Analysis Method before activating CI-based analysis. Then run the SonarQube workflow manually and confirm that the analysis appears on the intended project and the GitHub quality-gate check completes. Only then consider making the check required for merging.

## Verification status

The workflow and source configuration are prepared. YAML parsing, official actionlint v1.7.12, formatting and documentation checks passed. The public project SahilWikhe_Rove_Mobile and organization sahilwikhe were verified through the SonarQube component API. SONAR_PROJECT_KEY, SONAR_ORGANIZATION and SONAR_HOST_URL have been set and read back in GitHub repository variables. GitHub secret metadata confirms SONAR_TOKEN was saved on September 13; its value was not read. Token validity, Automatic Analysis state and a successful hosted scan remain unverified. No SonarQube scan or quality-gate result is asserted yet. The first scan may surface existing findings that need review; it is not a substitute for RLS, native-device or real-provider acceptance checks.

References: [official scanner action](https://github.com/SonarSource/sonarqube-scan-action), [GitHub Actions setup](https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/ci-based-analysis/github-actions-for-sonarcloud), [JavaScript/TypeScript coverage](https://docs.sonarsource.com/sonarqube-cloud/enriching/test-coverage/javascript-typescript-test-coverage).
