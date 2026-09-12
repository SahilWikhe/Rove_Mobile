import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { QuoteService, RideService, developmentRates, type MapsProvider } from '@rove/server';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from './app';
import { oidcIdentity } from './auth';
let db: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof createApp>;
let signed: (sub?: string, issuer?: string) => Promise<string>;
const send = vi.fn(async (_subject: string) => {});
const config = {
  issuer: 'https://rove-test.us.auth0.com/',
  audience: 'rove-api',
  jwksUrl: 'https://rove-test.us.auth0.com/.well-known/jwks.json',
};
beforeAll(async () => {
  db = await testDatabase();
  const pair = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [await exportJWK(pair.publicKey)] });
  signed = (sub = 'auth0|test-user', issuer = config.issuer) =>
    new SignJWT({})
      .setSubject(sub)
      .setIssuer(issuer)
      .setAudience(config.audience)
      .setIssuedAt()
      .setExpirationTime('1m')
      .setProtectedHeader({ alg: 'RS256' })
      .sign(pair.privateKey);
  const maps: MapsProvider = {
    search: async () => [],
    resolve: async () => {
      throw Error('unused');
    },
    route: async () => ({ distanceMeters: 1, durationSeconds: 1 }),
  };
  app = createApp({
    pool: db.pool,
    maps,
    rides: new RideService(db.pool),
    quotes: new QuoteService(db.pool, maps, developmentRates, { south: 35, north: 37, west: -80, east: -77 }),
    flags: async () => ({ scheduling: false, weekly: false, monthly: false }),
    verifyIdentity: oidcIdentity({ ...config, requireVerifiedEmail: true }, keys),
    verificationEmail: { verifyIdentity: oidcIdentity(config, keys), request: send },
  });
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  send.mockClear();
  await db.pool.query('TRUNCATE users,rate_limit_buckets CASCADE');
});
function request(token: string, body: unknown = {}) {
  return app.request('/auth/v1/verification-email', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
test('signed unverified signup may request email, but still cannot load or create a profile', async () => {
  const token = await signed();
  const response = await request(token);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ requested: true });
  expect(send).toHaveBeenCalledWith(config.issuer + '|auth0|test-user');
  for (const method of ['GET', 'POST']) {
    expect(
      (await app.request('/v1/me', { method, headers: { Authorization: 'Bearer ' + token } })).status,
    ).toBe(403);
  }
});
test('bad signatures, wrong issuer and recipient injection cannot send an email', async () => {
  expect((await request('invalid')).status).toBe(401);
  expect((await request(await signed('auth0|test-user', 'https://other.auth0.com/'))).status).toBe(401);
  expect((await request(await signed(), { user_id: 'auth0|victim' })).status).toBe(400);
  expect(send).not.toHaveBeenCalled();
});
test('disabled profiles cannot request email and concurrent requests share the database limit', async () => {
  const token = await signed();
  await db.pool.query(
    "INSERT INTO users (subject,name,role,disabled) VALUES ($1,'Synthetic user','rider',true)",
    [config.issuer + '|auth0|test-user'],
  );
  expect((await request(token)).status).toBe(403);
  expect(send).not.toHaveBeenCalled();
  await db.pool.query('UPDATE users SET disabled=false');
  const responses = await Promise.all(Array.from({ length: 5 }, () => request(token)));
  expect(responses.map((r) => r.status).sort()).toEqual([202, 429, 429, 429, 429]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(responses.find((r) => r.status === 429)?.headers.get('Retry-After')).toBeTruthy();
});
test('tenant budget bounds many distinct verified identities', async () => {
  for (let i = 0; i < 30; i++) expect((await request(await signed('auth0|user-' + i))).status).toBe(202);
  expect((await request(await signed('auth0|over-budget'))).status).toBe(429);
  expect(send).toHaveBeenCalledTimes(30);
});
