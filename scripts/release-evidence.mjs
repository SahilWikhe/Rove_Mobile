import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Validate provenance as well as success; names alone are not trusted evidence. */
export function checkReleaseEvidence({ repository, sha, ci, providers, ciJobs, providerJobs }) {
  const fail = (reason) => {
    throw new Error(reason);
  };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha))
    fail('Invalid release identity.');
  for (const [run, path] of [
    [ci, '.github/workflows/ci.yml'],
    [providers, '.github/workflows/staging-providers.yml'],
  ]) {
    if (
      run?.head_sha !== sha ||
      run?.head_branch !== 'main' ||
      run?.head_repository?.full_name !== repository ||
      run?.repository?.full_name !== repository ||
      run?.path !== path ||
      !['push', 'workflow_dispatch'].includes(run?.event) ||
      run?.status !== 'completed' ||
      run?.conclusion !== 'success' ||
      !Number.isSafeInteger(run?.id) ||
      run.id < 1 ||
      !Number.isSafeInteger(run?.run_attempt) ||
      run.run_attempt < 1
    )
      fail('Run is not successful main-branch evidence for this release.');
  }
  const required = [
    'quality',
    'tests',
    'infrastructure',
    'security',
    'codeql',
    'mobile',
    'browser',
    'native-android (rider)',
    'native-android (driver)',
    'native-ios (rider)',
    'native-ios (driver)',
    'ci-gate',
  ];
  for (const [run, jobs, names] of [
    [ci, ciJobs, required],
    [providers, providerJobs, ['providers']],
  ]) {
    if (!Array.isArray(jobs)) fail('Job evidence is missing.');
    for (const name of names) {
      const matches = jobs.filter((job) => job.name === name);
      if (
        matches.length !== 1 ||
        matches[0].run_id !== run.id ||
        matches[0].run_attempt !== run.run_attempt ||
        matches[0].head_sha !== sha ||
        matches[0].status !== 'completed' ||
        matches[0].conclusion !== 'success'
      )
        fail('Required release job is missing, stale or unsuccessful.');
    }
  }
  return {
    repository,
    sha,
    ciRun: ci.id,
    ciAttempt: ci.run_attempt,
    providerRun: providers.id,
    providerAttempt: providers.run_attempt,
    checksPassed: true,
    productionAuthorized: false,
  };
}
function api(path) {
  return JSON.parse(
    execFileSync('gh', ['api', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    }),
  );
}
function jobs(repository, run) {
  const result = [];
  let total;
  for (let page = 1; page <= 20; page++) {
    const response = api(
      `repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`,
    );
    if (
      !Array.isArray(response.jobs) ||
      !Number.isSafeInteger(response.total_count) ||
      response.total_count < 1 ||
      (total !== undefined && total !== response.total_count)
    )
      throw new Error('Invalid job pagination');
    total = response.total_count;
    result.push(...response.jobs);
    if (result.length === total) return result;
    if (response.jobs.length === 0 || result.length > total) throw new Error('Incomplete job pagination');
  }
  throw new Error('Job pagination exceeded');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [repository, sha, ciId, providerId, ...rest] = process.argv.slice(2);
  if (
    rest.length ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
    !/^[a-f0-9]{40}$/.test(sha ?? '') ||
    !/^[1-9][0-9]*$/.test(ciId ?? '') ||
    !/^[1-9][0-9]*$/.test(providerId ?? '')
  ) {
    console.error(
      'Usage: pnpm release:check <owner/repository> <full-sha> <ci-run-id> <staging-provider-run-id>',
    );
    process.exitCode = 1;
  } else {
    try {
      const ci = api(`repos/${repository}/actions/runs/${ciId}`),
        providers = api(`repos/${repository}/actions/runs/${providerId}`);
      const evidence = {
        repository,
        sha,
        ci,
        providers,
        ciJobs: jobs(repository, ci),
        providerJobs: jobs(repository, providers),
      };
      checkReleaseEvidence(evidence);
      // A rerun invalidates the attempt whose jobs were just collected.
      const latestCi = api(`repos/${repository}/actions/runs/${ciId}`);
      const latestProviders = api(`repos/${repository}/actions/runs/${providerId}`);
      if (
        latestCi.id !== ci.id ||
        latestProviders.id !== providers.id ||
        latestCi.run_attempt !== ci.run_attempt ||
        latestProviders.run_attempt !== providers.run_attempt
      )
        throw new Error('Run attempt changed during collection');
      const result = checkReleaseEvidence({ ...evidence, ci: latestCi, providers: latestProviders });
      console.log(JSON.stringify(result, null, 2));
      console.log(
        'These checks do not authorize production or replace hosted app/device acceptance, migration review and backup verification.',
      );
    } catch {
      console.error(
        'Release evidence is incomplete, unsuccessful or does not match the exact commit. No deployment performed.',
      );
      process.exitCode = 1;
    }
  }
}
