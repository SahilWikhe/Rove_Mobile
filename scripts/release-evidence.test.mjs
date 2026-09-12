import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReleaseEvidence } from './release-evidence.mjs';
const sha = 'a'.repeat(40),
  repository = 'example/rove';
function fixture() {
  const run = (id, path) => ({
    id,
    path,
    run_attempt: 2,
    head_sha: sha,
    head_branch: 'main',
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
  });
  const ci = run(1, '.github/workflows/ci.yml'),
    providers = run(2, '.github/workflows/staging-providers.yml');
  const job = (name, run) => ({
    name,
    run_id: run.id,
    run_attempt: run.run_attempt,
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
  });
  return {
    repository,
    sha,
    ci,
    providers,
    ciJobs: [
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
    ].map((name) => job(name, ci)),
    providerJobs: [job('providers', providers)],
  };
}
test('same-commit evidence passes without authorizing production', () => {
  const result = checkReleaseEvidence(fixture());
  assert.equal(result.checksPassed, true);
  assert.equal(result.productionAuthorized, false);
});
test('old commits, fork runs, other workflows, PR events and pending/failed runs cannot authorize a candidate', () => {
  for (const change of [
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'feature' },
    { head_repository: { full_name: 'fork/rove' } },
    { repository: { full_name: 'other/rove' } },
    { path: '.github/workflows/other.yml' },
    { event: 'pull_request' },
    { status: 'in_progress' },
    { conclusion: 'failure' },
  ]) {
    for (const key of ['ci', 'providers']) {
      const input = fixture();
      Object.assign(input[key], change);
      assert.throws(() => checkReleaseEvidence(input));
    }
  }
});
test('missing, skipped, duplicate, old-attempt and wrong-commit jobs fail closed', () => {
  for (const change of [
    { conclusion: 'skipped' },
    { run_attempt: 1 },
    { head_sha: 'b'.repeat(40) },
    { run_id: 99 },
  ]) {
    const input = fixture();
    Object.assign(input.ciJobs[0], change);
    assert.throws(() => checkReleaseEvidence(input));
  }
  const missing = fixture();
  missing.ciJobs.pop();
  assert.throws(() => checkReleaseEvidence(missing));
  const duplicate = fixture();
  duplicate.providerJobs.push(duplicate.providerJobs[0]);
  assert.throws(() => checkReleaseEvidence(duplicate));
  const skipped = fixture();
  skipped.providerJobs[0].conclusion = 'skipped';
  assert.throws(() => checkReleaseEvidence(skipped));
});
