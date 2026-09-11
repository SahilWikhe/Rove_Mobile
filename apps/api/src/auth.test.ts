import { expect, test } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { oidcIdentity, VERIFIED_EMAIL_CLAIM } from './auth';
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
  expect(await verify(await token())).toEqual({ subject: 'https://identity.example|user-1', mfa: false });
  for (const claims of [
    { iss: 'https://attacker.example' },
    { aud: 'other-api' },
    { exp: 1 },
    { sub: undefined },
    { iat: undefined },
  ]) {
    await expect(verify(await token(claims))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  }
  for (const amr of [undefined, [], ['pwd'], ['otp'], 'mfa', ['MFA'], ['mfa', 1], { mfa: true }]) {
    expect((await verify(await token({ amr }))).mfa).toBe(false);
  }
  for (const amr of [['mfa'], ['pwd', 'otp', 'mfa']]) {
    expect((await verify(await token({ amr }))).mfa).toBe(true);
  }
  const valid = await token({ amr: ['mfa'] });
  await expect(verify(`${valid.slice(0, -10)}0000000000`)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
});

test('verified email gate trusts only a signed boolean claim and preserves authentication failures', async () => {
  const pair = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [await exportJWK(pair.publicKey)] });
  const config = {
    issuer: 'https://identity.example',
    audience: 'rove-api',
    jwksUrl: 'https://identity.example/jwks',
  };
  const verify = oidcIdentity({ ...config, requireVerifiedEmail: true }, keys);
  const token = (claims: Record<string, unknown>) =>
    new SignJWT(claims)
      .setSubject('user-1')
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setIssuedAt()
      .setExpirationTime('1m')
      .setProtectedHeader({ alg: 'RS256' })
      .sign(pair.privateKey);
  for (const value of [undefined, false, 'true', 1, null, ['true']]) {
    const unverified = await token({ [VERIFIED_EMAIL_CLAIM]: value, email_verified: true });
    await expect(verify(unverified)).rejects.toMatchObject({
      code: 'EMAIL_VERIFICATION_REQUIRED',
      status: 403,
    });
    await expect(oidcIdentity(config, keys)(unverified)).resolves.toMatchObject({
      subject: 'https://identity.example|user-1',
    });
  }
  const verified = await token({ [VERIFIED_EMAIL_CLAIM]: true });
  await expect(verify(verified)).resolves.toMatchObject({ subject: 'https://identity.example|user-1' });
  await expect(verify(`${verified.slice(0, -10)}0000000000`)).rejects.toMatchObject({
    code: 'UNAUTHENTICATED',
    status: 401,
  });
});
