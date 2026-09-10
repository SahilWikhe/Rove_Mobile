import { expect, test } from 'vitest';
import { localAuthConfig } from './local-auth';
test('ordinary local and e2e runs retain synthetic identity', () => {
  expect(localAuthConfig({})).toBeUndefined();
  expect(localAuthConfig({ ROVE_E2E: '1' })).toBeUndefined();
});
test.each([{ NODE_ENV: 'production' }, { VERCEL: '1' }, { VERCEL: '' }])(
  'rejects deployment context before choosing an identity mode',
  (env) => {
    expect(() => localAuthConfig(env)).toThrow('forbidden');
  },
);
test.each([{ ROVE_LOCAL_AUTH: 'production' }, { ROVE_LOCAL_AUTH: 'auth0', ROVE_E2E: '1' }])(
  'rejects invalid or mixed fixture mode',
  (env) => {
    expect(() => localAuthConfig(env)).toThrow('Unsupported');
  },
);
test('explicit auth0 mode pins the staging identity authority despite ambient credentials', () => {
  const config = localAuthConfig({ ROVE_LOCAL_AUTH: 'auth0', OIDC_ISSUER: 'https://production.example/' });
  expect(config?.issuer).toBe('https://dev-1x3fgtb2cj2nfbj1.us.auth0.com/');
  expect(config?.audience).toBe('https://api.staging.roveride.co');
});
