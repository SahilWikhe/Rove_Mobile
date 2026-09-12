import { expect, test } from 'vitest';
import { readAccountClosureConfig } from './account-closure-config';
test('closure defaults off and requires approved policy and dedicated provider credentials', () => {
  expect(readAccountClosureConfig({})).toBeUndefined();
  expect(readAccountClosureConfig({ ACCOUNT_CLOSURE_ENABLED: 'false' })).toBeUndefined();
  for (const env of [
    { ACCOUNT_CLOSURE_ENABLED: 'yes' },
    { ACCOUNT_CLOSURE_ENABLED: 'true' },
    { ACCOUNT_CLOSURE_ENABLED: 'true', ACCOUNT_CLOSURE_POLICY_REFERENCE: 'policy-v1' },
  ])
    expect(() => readAccountClosureConfig(env)).toThrow('accountClosure');
  const env = {
    ACCOUNT_CLOSURE_ENABLED: 'true',
    ACCOUNT_CLOSURE_POLICY_REFERENCE: 'policy-v1',
    OIDC_ISSUER: 'https://synthetic.us.auth0.com/',
    AUTH0_DELETION_CLIENT_ID: 'synthetic',
    AUTH0_DELETION_CLIENT_SECRET: 'synthetic-secret',
  };
  expect(readAccountClosureConfig(env)).toMatchObject({ policyReference: 'policy-v1' });
  expect(() => readAccountClosureConfig({ ...env, AUTH0_DELETION_CLIENT_SECRET: undefined })).toThrow(
    'identityDeletion',
  );
});
