import { expect, test, vi } from 'vitest';
import { Auth0IdentityDeletion, readIdentityDeletionConfig } from './identity-deletion';
const config = {
  issuer: 'https://rove-test.us.auth0.com/',
  clientId: 'synthetic-delete-client',
  clientSecret: 'synthetic-secret',
};
const userId = 'auth0|synthetic-user';
const subject = config.issuer + '|' + userId;
const token = () => Response.json({ access_token: 'synthetic-token', token_type: 'Bearer', expires_in: 120 });
const present = () => Response.json({ user_id: userId });
const absent = () =>
  Response.json({ statusCode: 404, error: 'Not Found', message: 'User not found' }, { status: 404 });
const deleted = () => new Response(null, { status: 204 });

test('dedicated optional credentials reject partial configuration and unsafe issuers', () => {
  expect(readIdentityDeletionConfig({})).toBeUndefined();
  expect(readIdentityDeletionConfig({ AUTH0_VERIFICATION_CLIENT_ID: 'synthetic' })).toBeUndefined();
  const env = {
    OIDC_ISSUER: config.issuer,
    AUTH0_DELETION_CLIENT_ID: config.clientId,
    AUTH0_DELETION_CLIENT_SECRET: config.clientSecret,
  };
  expect(readIdentityDeletionConfig(env)).toEqual(config);
  for (const override of [
    { AUTH0_DELETION_CLIENT_SECRET: undefined },
    { AUTH0_DELETION_CLIENT_ID: '' },
    { OIDC_ISSUER: 'http://rove.auth0.com/' },
    { OIDC_ISSUER: 'https://rove.auth0.com.evil.test/' },
    { OIDC_ISSUER: 'https://name:password@rove.auth0.com/' },
    { OIDC_ISSUER: 'https://rove.auth0.com/?x=1' },
  ])
    expect(() => readIdentityDeletionConfig({ ...env, ...override })).toThrow('identityDeletion');
});

test('exact tenant subject and matching retrieved identity required before any deletion', async () => {
  const transport = vi.fn<typeof fetch>();
  const provider = new Auth0IdentityDeletion(config, transport);
  for (const value of [
    'auth0|synthetic-user',
    'https://other.auth0.com/|' + userId,
    config.issuer + '|auth0|x|y',
    config.issuer + '|auth0|\nuser',
    config.issuer + '|auth0|' + 'a'.repeat(300),
  ])
    await expect(provider.erase(value)).rejects.toMatchObject({ code: 'IDENTITY_DELETION_SUBJECT_INVALID' });
  expect(transport).not.toHaveBeenCalled();
  transport
    .mockResolvedValueOnce(token())
    .mockResolvedValueOnce(Response.json({ user_id: 'auth0|someone-else' }));
  await expect(provider.erase(subject)).rejects.toMatchObject({ code: 'IDENTITY_DELETION_UNAVAILABLE' });
  expect(transport.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']);
});

test('delete is followed by an authenticated direct absence check with minimal fields and no redirects', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(token())
    .mockResolvedValueOnce(present())
    .mockResolvedValueOnce(deleted())
    .mockResolvedValueOnce(absent());
  expect(await new Auth0IdentityDeletion(config, transport).erase(subject)).toEqual({ status: 'absent' });
  expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    audience: config.issuer + 'api/v2/',
    scope: 'read:users delete:users',
  });
  expect(transport.mock.calls.slice(1).map(([url, init]) => [url, init?.method])).toEqual([
    [config.issuer + 'api/v2/users/auth0%7Csynthetic-user?fields=user_id&include_fields=true', 'GET'],
    [config.issuer + 'api/v2/users/auth0%7Csynthetic-user', 'DELETE'],
    [config.issuer + 'api/v2/users/auth0%7Csynthetic-user?fields=user_id&include_fields=true', 'GET'],
  ]);
  for (const [, init] of transport.mock.calls) {
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  }
});

test('already absent identities and lost DELETE responses recover without another mutation', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(token())
    .mockResolvedValueOnce(present())
    .mockRejectedValueOnce(new Error('private request detail'))
    .mockResolvedValueOnce(absent());
  const provider = new Auth0IdentityDeletion(config, transport);
  await expect(provider.erase(subject)).rejects.toMatchObject({ code: 'IDENTITY_DELETION_UNAVAILABLE' });
  expect(await provider.erase(subject)).toEqual({ status: 'absent' });
  expect(transport.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
});

test('successful DELETE alone is not treated as identity absence', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(token())
    .mockResolvedValueOnce(present())
    .mockResolvedValueOnce(deleted())
    .mockResolvedValueOnce(present());
  await expect(new Auth0IdentityDeletion(config, transport).erase(subject)).rejects.toMatchObject({
    code: 'IDENTITY_DELETION_UNAVAILABLE',
  });
  expect(transport).toHaveBeenCalledTimes(4);
});

test.each([401, 403, 429, 500, 302, 202])(
  'GET %s never proves absence or permits a DELETE',
  async (status) => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response('private provider detail', { status }));
    await expect(new Auth0IdentityDeletion(config, transport).erase(subject)).rejects.toThrow(
      'Identity deletion could not be verified',
    );
    expect(transport).toHaveBeenCalledTimes(2);
  },
);

test('an unstructured HTTP 404 cannot falsely complete deletion', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(token())
    .mockResolvedValueOnce(new Response('proxy not found', { status: 404 }));
  await expect(new Auth0IdentityDeletion(config, transport).erase(subject)).rejects.toMatchObject({
    status: 503,
  });
});

test.each([401, 403, 404, 429, 500, 202])(
  'DELETE %s stays retryable rather than reporting completion',
  async (status) => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(present())
      .mockResolvedValueOnce(new Response('private provider detail', { status }));
    await expect(new Auth0IdentityDeletion(config, transport).erase(subject)).rejects.toMatchObject({
      status: 503,
    });
    expect(transport).toHaveBeenCalledTimes(3);
  },
);

test('social subject is encoded as one URL segment and never selects another endpoint', async () => {
  const socialId = 'google-oauth2|synthetic/a?b#c';
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(token())
    .mockResolvedValueOnce(Response.json({ user_id: socialId }))
    .mockResolvedValueOnce(deleted())
    .mockResolvedValueOnce(absent());
  await new Auth0IdentityDeletion(config, transport).erase(config.issuer + '|' + socialId);
  expect(transport.mock.calls[2]?.[0]).toBe(config.issuer + 'api/v2/users/' + encodeURIComponent(socialId));
});

test('tokens are shared for concurrent workers and renewed after expiry or authorization failure', async () => {
  let now = 0;
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) => (String(url).endsWith('oauth/token') ? token() : absent()));
  const provider = new Auth0IdentityDeletion(config, transport, () => now);
  await Promise.all([provider.erase(subject), provider.erase(subject)]);
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith('oauth/token'))).toHaveLength(1);
  now = 61_000;
  await provider.erase(subject);
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith('oauth/token'))).toHaveLength(2);
  transport.mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(provider.erase(subject)).rejects.toMatchObject({ status: 503 });
  await provider.erase(subject);
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith('oauth/token'))).toHaveLength(3);
});

test('missing granted scope, invalid token or network detail cannot leak or authorize a mutation', async () => {
  for (const body of [
    { access_token: 'synthetic-token', token_type: 'Bearer', expires_in: 120, scope: 'read:users' },
    { access_token: 'private provider detail', expires_in: 120 },
  ]) {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(body));
    await expect(new Auth0IdentityDeletion(config, transport).erase(subject)).rejects.toThrow(
      'Identity deletion could not be verified',
    );
    expect(transport).toHaveBeenCalledTimes(1);
  }
});
