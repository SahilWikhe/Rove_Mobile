import { describe, expect, it } from 'vitest';
import { readApiConfig, ConfigurationError } from './config';
const rates = {
  version: 'policy-v1',
  baseCents: 300,
  centsPerKilometer: 90,
  centsPerMinute: 25,
  minimumCents: 700,
  driverBaseCents: 200,
  driverCentsPerKilometer: 70,
  driverCentsPerMinute: 20,
  driverMinimumCents: 550,
};
function environment(): Record<string, string | undefined> {
  return {
    ROVE_ENVIRONMENT: 'staging',
    DATABASE_URL: 'postgresql://fixture:fixture-secret@db.example.test/rove?sslmode=verify-full',
    OIDC_ISSUER: 'https://identity.example.test/',
    OIDC_AUDIENCE: 'rove-api',
    OIDC_JWKS_URL: 'https://identity.example.test/.well-known/jwks.json',
    GOOGLE_MAPS_API_KEY: 'fixture-map-secret',
    RATE_POLICY_JSON: JSON.stringify(rates),
    SERVICE_AREA_JSON: JSON.stringify({ south: 35, north: 37, west: -80, east: -77 }),
  };
}
describe('deployment configuration', () => {
  it('parses explicit settings without reading ambient environment or enabling browser origins', () => {
    const config = readApiConfig(environment());
    expect(config.allowedOrigins).toEqual([]);
    expect(config.rates).toEqual(rates);
    expect(config.environment).toBe('staging');
  });
  it('requires every credential, pricing policy and service area with secret-safe errors', () => {
    for (const key of [
      'DATABASE_URL',
      'OIDC_ISSUER',
      'OIDC_AUDIENCE',
      'OIDC_JWKS_URL',
      'GOOGLE_MAPS_API_KEY',
      'RATE_POLICY_JSON',
      'SERVICE_AREA_JSON',
    ]) {
      const env = environment();
      delete env[key];
      expect(() => readApiConfig(env), key).toThrow(ConfigurationError);
    }
    const env = environment();
    env.DATABASE_URL += '&sslpassword=do-not-print-me';
    try {
      readApiConfig(env);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).not.toMatch(/fixture-secret|do-not-print-me|postgresql/);
    }
  });
  it('rejects weak or ambiguous TLS configuration', () => {
    for (const query of [
      '',
      '?sslmode=require',
      '?sslmode=disable',
      '?sslmode=verify-full&sslmode=disable',
      '?sslmode=verify-full&uselibpqcompat=true',
    ]) {
      const env = environment();
      env.DATABASE_URL = 'postgresql://fixture:secret@db.example.test/rove' + query;
      expect(() => readApiConfig(env), query).toThrow(ConfigurationError);
    }
  });
  it('rejects insecure identity endpoints and wildcard or path-bearing browser origins', () => {
    for (const url of [
      'http://identity.example.test',
      'https://user:secret@identity.example.test',
      'https://identity.example.test/#fragment',
    ]) {
      expect(() => readApiConfig({ ...environment(), OIDC_ISSUER: url })).toThrow();
    }
    for (const origin of ['*', 'http://ops.example.test', 'https://ops.example.test/path']) {
      expect(() =>
        readApiConfig({ ...environment(), ALLOWED_ORIGINS_JSON: JSON.stringify([origin]) }),
      ).toThrow();
    }
    expect(
      readApiConfig({ ...environment(), ALLOWED_ORIGINS_JSON: '["https://ops.example.test"]' })
        .allowedOrigins,
    ).toHaveLength(1);
  });
  it('rejects malformed policies, fractional money and inverted service boundaries', () => {
    for (const policy of [
      'not-json-secret',
      JSON.stringify({ ...rates, baseCents: 1.5 }),
      JSON.stringify({ ...rates, unexpected: true }),
    ])
      expect(() => readApiConfig({ ...environment(), RATE_POLICY_JSON: policy })).toThrow(ConfigurationError);
    expect(() =>
      readApiConfig({ ...environment(), SERVICE_AREA_JSON: '{"south":37,"north":35,"west":-80,"east":-77}' }),
    ).toThrow();
  });
  it('requires explicit version approval in production and rejects synthetic rates or environment crossover', () => {
    const env = { ...environment(), ROVE_ENVIRONMENT: 'production' };
    expect(() => readApiConfig(env)).toThrow();
    expect(() => readApiConfig({ ...env, RATE_POLICY_APPROVED_VERSION: rates.version })).not.toThrow();
    expect(() =>
      readApiConfig({ ...env, RATE_POLICY_APPROVED_VERSION: rates.version, VERCEL_ENV: 'preview' }),
    ).toThrow();
    expect(() =>
      readApiConfig({
        ...env,
        RATE_POLICY_APPROVED_VERSION: 'synthetic-v1',
        RATE_POLICY_JSON: JSON.stringify({ ...rates, version: 'synthetic-v1' }),
      }),
    ).toThrow();
    expect(() => readApiConfig({ ...environment(), ROVE_SYNTHETIC: 'true' })).toThrow();
  });
});

it('email verification rollout is explicit in staging and mandatory in production', () => {
  expect(readApiConfig(environment()).oidcRequireVerifiedEmail).toBe(false);
  expect(
    readApiConfig({ ...environment(), OIDC_REQUIRE_VERIFIED_EMAIL: 'true' }).oidcRequireVerifiedEmail,
  ).toBe(true);
  for (const value of ['', 'TRUE', '1'])
    expect(() => readApiConfig({ ...environment(), OIDC_REQUIRE_VERIFIED_EMAIL: value })).toThrow(
      ConfigurationError,
    );
  const production = {
    ...environment(),
    ROVE_ENVIRONMENT: 'production',
    RATE_POLICY_APPROVED_VERSION: rates.version,
  };
  expect(readApiConfig(production).oidcRequireVerifiedEmail).toBe(true);
  expect(() => readApiConfig({ ...production, OIDC_REQUIRE_VERIFIED_EMAIL: 'false' })).toThrow(
    ConfigurationError,
  );
});
