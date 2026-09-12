import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function validateCandidate(input) {
  const { sha, workflowSha, ref, repository, ciId, providerId } = input;
  if (
    ref !== 'refs/heads/main' ||
    !/^[a-f0-9]{40}$/.test(sha ?? '') ||
    !/^[a-f0-9]{40}$/.test(workflowSha ?? '') ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
    !/^[1-9][0-9]*$/.test(ciId ?? '') ||
    !/^[1-9][0-9]*$/.test(providerId ?? '')
  )
    throw new Error('Use main, a full commit SHA and numeric run IDs.');
  return { sha, workflowSha, ref, repository, ciId, providerId };
}

export function verifyAncestry(input, run = execFileSync) {
  const candidate = validateCandidate(input);
  const head = run('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== candidate.workflowSha) throw new Error('Checkout does not match the workflow commit.');
  run('git', ['merge-base', '--is-ancestor', candidate.sha, candidate.workflowSha], { stdio: 'pipe' });
  return candidate;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const candidate = verifyAncestry({
      sha: process.env.CANDIDATE_SHA,
      workflowSha: process.env.GITHUB_SHA,
      ref: process.env.GITHUB_REF,
      repository: process.env.GITHUB_REPOSITORY,
      ciId: process.env.CI_RUN_ID,
      providerId: process.env.PROVIDER_RUN_ID,
    });
    const report = execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('./release-evidence.mjs', import.meta.url)),
        candidate.repository,
        candidate.sha,
        candidate.ciId,
        candidate.providerId,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 },
    );
    mkdirSync('release-readiness', { recursive: true });
    writeFileSync(
      'release-readiness/evidence.txt',
      `Collected at ${new Date().toISOString()}\nVerifier source: ${candidate.workflowSha}\n${report}`,
    );
    if (process.env.GITHUB_STEP_SUMMARY)
      writeFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## Release evidence verified\n\nCandidate: \`${candidate.sha}\`\n\nCI run: ${candidate.ciId}; staging provider run: ${candidate.providerId}.\n\nThis is a point-in-time evidence report. No deployment, migration, provider request or production approval occurred. Device acceptance and release setup remain separate requirements.\n`,
        { flag: 'a' },
      );
    console.log('Release evidence verified. Report: release-readiness/evidence.txt');
  } catch {
    console.error(
      'Candidate readiness failed. Check main ancestry, checkout identity and successful matching run evidence. No deployment performed.',
    );
    process.exitCode = 1;
  }
}
