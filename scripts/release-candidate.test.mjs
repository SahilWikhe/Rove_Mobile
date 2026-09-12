import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCandidate, verifyAncestry } from './release-candidate.mjs';
const input = {
  sha: 'a'.repeat(40),
  workflowSha: 'b'.repeat(40),
  ref: 'refs/heads/main',
  repository: 'example/rove',
  ciId: '123',
  providerId: '456',
};
test('release inputs reject refs, abbreviated hashes and shell/option-like values before executing git', () => {
  for (const change of [
    { ref: 'refs/heads/feature' },
    { sha: 'main' },
    { sha: '--help' },
    { sha: 'a'.repeat(39) },
    { ciId: '1;echo secret' },
    { providerId: '-1' },
    { repository: 'example/rove/../../other' },
    { workflowSha: '' },
  ])
    assert.throws(() =>
      verifyAncestry({ ...input, ...change }, () => {
        assert.fail('must not execute');
      }),
    );
  assert.deepEqual(validateCandidate(input), input);
});
test('release candidate must belong to checked-out main history, not merely exist in git', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rove-release-ancestry-'));
  const run = (cmd, args, opts) => execFileSync(cmd, args, { ...opts, cwd: dir });
  const git = (...args) => run('git', args, { encoding: 'utf8' }).trim();
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('commit', '--allow-empty', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-b', 'unmerged');
    git('commit', '--allow-empty', '-m', 'other');
    const other = git('rev-parse', 'HEAD');
    git('checkout', 'main');
    git('commit', '--allow-empty', '-m', 'main');
    const head = git('rev-parse', 'HEAD');
    assert.equal(verifyAncestry({ ...input, sha: base, workflowSha: head }, run).sha, base);
    assert.throws(() => verifyAncestry({ ...input, sha: other, workflowSha: head }, run));
    assert.throws(() => verifyAncestry({ ...input, sha: base, workflowSha: base }, run), /Checkout/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
