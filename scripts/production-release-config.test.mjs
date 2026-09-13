import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionReleaseConfig } from './production-release-config.mjs';
const env = {
  PRODUCTION_RELEASE_ENABLED: 'true',
  VERCEL_PROJECT_ID: 'prj_production',
  STAGING_VERCEL_PROJECT_ID: 'prj_staging',
  VERCEL_ORG_ID: 'team_synthetic',
  CANDIDATE_SHA: 'a'.repeat(40),
  RELEASE_REVIEW_REFERENCE: 'release/approved-1',
};
test('requires explicit enablement and separate exact production target', () => {
  assert.equal(
    productionReleaseConfig(env, { projectId: env.VERCEL_PROJECT_ID, orgId: env.VERCEL_ORG_ID }).sha,
    env.CANDIDATE_SHA,
  );
  for (const key of Object.keys(env))
    assert.throws(() => productionReleaseConfig({ ...env, [key]: undefined }));
  for (const change of [
    { PRODUCTION_RELEASE_ENABLED: 'TRUE' },
    { VERCEL_PROJECT_ID: env.STAGING_VERCEL_PROJECT_ID },
    { CANDIDATE_SHA: 'main' },
    { RELEASE_REVIEW_REFERENCE: 'unsafe\nreference' },
  ])
    assert.throws(() => productionReleaseConfig({ ...env, ...change }));
  assert.throws(() =>
    productionReleaseConfig(env, { projectId: env.STAGING_VERCEL_PROJECT_ID, orgId: env.VERCEL_ORG_ID }),
  );
  assert.throws(() =>
    productionReleaseConfig(env, { projectId: env.VERCEL_PROJECT_ID, orgId: 'team_other' }),
  );
});
