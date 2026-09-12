import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

function command(t, modify = () => {}, args = [repository, sha, '1', '2']) {
  const directory = mkdtempSync(join(tmpdir(), 'rove-release-evidence-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const data = fixture();
  const base = `repos/${repository}/actions/runs`;
  const responses = {
    [`${base}/1`]: [data.ci, data.ci],
    [`${base}/2`]: [data.providers, data.providers],
    [`${base}/1/attempts/2/jobs?per_page=100&page=1`]: [{ total_count: 12, jobs: data.ciJobs.slice(0, 6) }],
    [`${base}/1/attempts/2/jobs?per_page=100&page=2`]: [{ total_count: 12, jobs: data.ciJobs.slice(6) }],
    [`${base}/2/attempts/2/jobs?per_page=100&page=1`]: [{ total_count: 1, jobs: data.providerJobs }],
  };
  modify(responses, base);
  writeFileSync(join(directory, 'responses.json'), JSON.stringify(responses));
  writeFileSync(
    join(directory, 'gh'),
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const callsPath = path.join(root, 'calls.json');
const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath)) : [];
const request = process.argv[3];
const index = calls.filter(value => value === request).length;
calls.push(request);
fs.writeFileSync(callsPath, JSON.stringify(calls));
const responses = JSON.parse(fs.readFileSync(path.join(root, 'responses.json')));
const response = responses[request]?.[index];
if (process.argv[2] !== 'api' || response === undefined) {
  console.error('private-provider-token-must-not-leak');
  process.exit(1);
}
console.log(JSON.stringify(response));
`,
    { mode: 0o700 },
  );
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./release-evidence.mjs', import.meta.url)), ...args],
    {
      encoding: 'utf8',
      timeout: 10000,
      env: { PATH: directory },
    },
  );
  const callsPath = join(directory, 'calls.json');
  return { ...result, calls: existsSync(callsPath) ? JSON.parse(readFileSync(callsPath, 'utf8')) : [] };
}

test('CLI collects paginated jobs and rechecks both current attempts before passing', (t) => {
  const result = command(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /"checksPassed": true/);
  assert.match(result.stdout, /"productionAuthorized": false/);
  assert.equal(result.calls.length, 7);
});

test('CLI fails if a workflow is rerun or loses success during collection', (t) => {
  for (const id of ['1', '2']) {
    for (const change of [{ run_attempt: 3 }, { status: 'in_progress', conclusion: null }]) {
      const result = command(t, (responses, base) => {
        responses[`${base}/${id}`][1] = { ...responses[`${base}/${id}`][1], ...change };
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
    }
  }
});

test('CLI rejects incomplete or changing pagination', (t) => {
  for (const change of [{ total_count: 13 }, { jobs: [] }, { total_count: -1 }]) {
    const result = command(t, (responses, base) => {
      Object.assign(responses[`${base}/1/attempts/2/jobs?per_page=100&page=2`][0], change);
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
});

test('CLI rejects malformed input without invoking gh and redacts provider errors', (t) => {
  for (const args of [[], [repository, sha, '1', '2', 'extra'], [repository, 'main', '1', '2']]) {
    const result = command(t, undefined, args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Usage:/);
    assert.deepEqual(result.calls, []);
  }
  const failed = command(t, (responses, base) => {
    delete responses[`${base}/1`];
  });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, '');
  assert.match(failed.stderr, /No deployment performed/);
  assert.ok(!failed.stderr.includes('private-provider-token'));
});
