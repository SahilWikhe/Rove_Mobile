import { expect, test, vi } from 'vitest';
import { Auth0VerificationEmail, readVerificationEmailConfig } from './verification-email';
const config = {
  issuer: 'https://rove-test.us.auth0.com/',
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
};
const subject = config.issuer + '|auth0|synthetic-user';
const token = () => Response.json({ access_token: 'synthetic-token', token_type: 'Bearer', expires_in: 120 });
const job = () =>
  Response.json({ id: 'job_test', type: 'verification_email', status: 'pending' }, { status: 201 });

test('optional credentials fail closed for partial configuration and unsafe or different destinations', () => {
  expect(readVerificationEmailConfig({})).toBeUndefined();
  const env = {
    OIDC_ISSUER: config.issuer,
    AUTH0_VERIFICATION_CLIENT_ID: config.clientId,
    AUTH0_VERIFICATION_CLIENT_SECRET: config.clientSecret,
  };
  expect(readVerificationEmailConfig(env)).toEqual(config);
  for (const overrides of [
    { AUTH0_VERIFICATION_CLIENT_SECRET: undefined },
    { AUTH0_VERIFICATION_CLIENT_ID: '' },
    { OIDC_ISSUER: 'http://rove.auth0.com/' },
    { OIDC_ISSUER: 'https://rove.auth0.com.evil.example/' },
    { OIDC_ISSUER: 'https://user:password@rove.auth0.com/' },
    { OIDC_ISSUER: 'https://rove.auth0.com/?redirect=evil' },
  ]) {
    expect(() => readVerificationEmailConfig({ ...env, ...overrides })).toThrow('verificationEmail');
  }
});

test('recipient comes only from exact verified tenant subject, with no email or client-controlled redirect', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(job());
  const provider = new Auth0VerificationEmail(config, transport);
  for (const value of [
    'auth0|synthetic-user',
    'https://other.auth0.com/|auth0|synthetic-user',
    config.issuer + '|google-oauth2|123',
    config.issuer + '|auth0|x|other',
  ]) {
    await expect(provider.request(value)).rejects.toMatchObject({ code: 'VERIFICATION_EMAIL_UNSUPPORTED' });
  }
  expect(transport).not.toHaveBeenCalled();
  await provider.request(subject);
  expect(transport.mock.calls[0]?.[0]).toBe(config.issuer + 'oauth/token');
  expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    audience: config.issuer + 'api/v2/',
    scope: 'update:users',
  });
  expect(transport.mock.calls[1]?.[0]).toBe(config.issuer + 'api/v2/jobs/verification-email');
  expect(JSON.parse(String(transport.mock.calls[1]?.[1]?.body))).toEqual({ user_id: 'auth0|synthetic-user' });
  for (const [, options] of transport.mock.calls) {
    expect(options?.redirect).toBe('error');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  }
});

test('concurrent sends share token acquisition and expired tokens are renewed', async () => {
  let now = 0;
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) => (String(url).endsWith('oauth/token') ? token() : job()));
  const provider = new Auth0VerificationEmail(config, transport, () => now);
  await Promise.all([provider.request(subject), provider.request(subject)]);
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith('oauth/token'))).toHaveLength(1);
  now = 61_000;
  await provider.request(subject);
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith('oauth/token'))).toHaveLength(2);
});

test('provider errors and ambiguous responses are sanitized and email jobs are never retried', async () => {
  for (const response of [
    new Response('private provider detail', { status: 429 }),
    new Response('private provider detail', { status: 401 }),
    Response.json({ secret: 'private provider detail' }, { status: 201 }),
    new Response('not json', { status: 201 }),
  ]) {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(response);
    await expect(new Auth0VerificationEmail(config, transport).request(subject)).rejects.toMatchObject({
      code: 'VERIFICATION_EMAIL_UNAVAILABLE',
      status: 503,
    });
    expect(transport).toHaveBeenCalledTimes(2);
  }
  const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('private network detail'));
  const provider = new Auth0VerificationEmail(config, transport);
  await expect(provider.request(subject)).rejects.toThrow('Check your inbox');
  transport.mockResolvedValueOnce(token()).mockResolvedValueOnce(job());
  await provider.request(subject);
  expect(transport).toHaveBeenCalledTimes(3);
});
