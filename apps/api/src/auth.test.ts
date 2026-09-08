import { expect, test } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { oidcIdentity } from './auth';
test('OIDC verifies signature, issuer, audience, expiry and required claims', async () => {
  const pair = await generateKeyPair('RS256');
  const jwk = await exportJWK(pair.publicKey);
  const verify = oidcIdentity(
    { issuer: 'https://identity.example', audience: 'rove-api', jwksUrl: 'https://identity.example/jwks' },
    createLocalJWKSet({ keys: [jwk] }),
  );
  const token = (overrides: Record<string, unknown> = {}) =>
    new SignJWT({
      sub: 'user-1',
      iss: 'https://identity.example',
      aud: 'rove-api',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      ...overrides,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .sign(pair.privateKey);
  expect(await verify(await token())).toEqual({ subject: 'https://identity.example|user-1' });
  for (const claims of [
    { iss: 'https://attacker.example' },
    { aud: 'other-api' },
    { exp: 1 },
    { sub: undefined },
    { iat: undefined },
  ]) {
    await expect(verify(await token(claims))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  }
  const valid = await token();
  await expect(verify(`${valid.slice(0, -10)}0000000000`)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
});
