import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Fail closed before pulling secrets or creating a production deployment. */
export function productionReleaseConfig(env, linkedProject) {
  const projectId = env.VERCEL_PROJECT_ID;
  const stagingProjectId = env.STAGING_VERCEL_PROJECT_ID;
  const orgId = env.VERCEL_ORG_ID;
  if (
    env.PRODUCTION_RELEASE_ENABLED !== 'true' ||
    !/^prj_[A-Za-z0-9]+$/.test(projectId ?? '') ||
    !/^prj_[A-Za-z0-9]+$/.test(stagingProjectId ?? '') ||
    projectId === stagingProjectId ||
    !/^team_[A-Za-z0-9]+$/.test(orgId ?? '') ||
    !/^[a-f0-9]{40}$/.test(env.CANDIDATE_SHA ?? '') ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/.test(env.RELEASE_REVIEW_REFERENCE ?? '')
  )
    throw new Error('Production release configuration is incomplete or not isolated from staging.');
  if (linkedProject && (linkedProject.projectId !== projectId || linkedProject.orgId !== orgId))
    throw new Error('Pulled Vercel project does not match the intended production target.');
  return { projectId, orgId, sha: env.CANDIDATE_SHA, reviewReference: env.RELEASE_REVIEW_REFERENCE };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 3) throw new Error('Unexpected arguments');
    productionReleaseConfig(
      process.env,
      process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : undefined,
    );
    console.log('Production release target checks passed. No deployment performed.');
  } catch {
    console.error(
      'Production release target checks failed. Check explicit enablement, isolated project/team, candidate SHA and review reference.',
    );
    process.exitCode = 1;
  }
}
