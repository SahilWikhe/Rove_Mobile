import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { developmentRates } from '@rove/server';
import { inspectStagingEnvironment } from './staging-preflight';

function fixture() {
  return {
    ROVE_ENVIRONMENT: 'staging',
    DATABASE_URL: 'postgresql://fixture:private@db.example.test/rove?sslmode=verify-full',
    OIDC_ISSUER: 'https://identity.example.test/',
    OIDC_AUDIENCE: 'rove-api',
    OIDC_JWKS_URL: 'https://identity.example.test/jwks',
    GOOGLE_MAPS_API_KEY: 'fixture',
    RATE_POLICY_JSON: JSON.stringify(developmentRates),
    SERVICE_AREA_JSON: JSON.stringify({ south: 35, north: 37, west: -80, east: -77 }),
    STRIPE_ACCOUNT_ID: 'acct_fixture',
    STRIPE_MODE: 'test',
    STRIPE_SECRET_KEY: 'rk_test_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    STRIPE_PAYMENT_METHOD_CONFIGURATION: 'pmc_fixture',
    CRON_SECRET: 'synthetic-recovery-secret-000000000000',
  };
}

test('accepts syntactically valid staging settings without returning any credentials', () => {
  expect(inspectStagingEnvironment(fixture())).toEqual({ valid: true, problems: [] });
});

test('rejects live payments, wrong environment, weak TLS and incomplete optional integrations', () => {
  for (const change of [
    { STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_fixture' },
    { ROVE_ENVIRONMENT: 'production' },
    { ROVE_ENVIRONMENT: 'preview' },
    { DATABASE_URL: fixture().DATABASE_URL.replace('verify-full', 'require') },
    { STRIPE_CONNECT_ONBOARDING_ENABLED: 'true' },
    { EXPO_PUSH_DELIVERY_ENABLED: 'true' },
    { ROVE_SYNTHETIC: 'true' },
    { CRON_SECRET: 'short' },
  ])
    expect(inspectStagingEnvironment({ ...fixture(), ...change }).valid).toBe(false);
});

test('reports configuration fields and recovery errors without echoing malformed secrets', () => {
  const result = inspectStagingEnvironment({
    ...fixture(),
    RATE_POLICY_JSON: 'PRIVATE-MALFORMED-POLICY',
    CRON_SECRET: 'PRIVATE-SECRET',
  });
  expect(result).toEqual({ valid: false, problems: ['CRON_SECRET', 'rates'] });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

test('CLI validates only the explicit file and signals failure with no secret output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rove-preflight-'));
  const path = join(dir, 'input.env');
  const cli = fileURLToPath(new URL('./staging-preflight-cli.ts', import.meta.url));
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...fixture(), PATH: process.env.PATH },
    });
  try {
    writeFileSync(path, 'ROVE_ENVIRONMENT=staging\nCRON_SECRET=PRIVATE-INVALID\n', { mode: 0o600 });
    const missing = run([path]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('databaseUrl');
    expect(missing.stderr).toContain('CRON_SECRET');
    expect(missing.stderr).not.toContain('PRIVATE');
    writeFileSync(
      path,
      Object.entries(fixture())
        .map(([key, value]) => `${key}='${value}'`)
        .join('\n'),
    );
    const good = run([path]);
    expect(good.status).toBe(0);
    expect(good.stdout).toContain('configuration shape passed');
    expect(good.stdout).not.toContain('rk_test_fixture');
    expect(run([]).status).toBe(1);
    const absent = run([join(dir, 'PRIVATE-FILENAME')]);
    expect(absent.status).toBe(1);
    expect(absent.stderr).not.toContain('PRIVATE-FILENAME');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // Four independently bounded (10s) CLI invocations can exceed Vitest's default 5s on CI.
}, 45_000);

test('independent missing integrations are reported together rather than masked by the first error', () => {
  const result = inspectStagingEnvironment({
    ...fixture(),
    GOOGLE_MAPS_API_KEY: undefined,
    STRIPE_SECRET_KEY: undefined,
    STRIPE_WEBHOOK_SECRET: undefined,
    STRIPE_PAYMENT_METHOD_CONFIGURATION: undefined,
    STRIPE_CONNECT_ONBOARDING_ENABLED: 'true',
    EXPO_PUSH_DELIVERY_ENABLED: 'true',
    DOCUMENT_UPLOADS_ENABLED: 'true',
    DOCUMENT_SCANNING_ENABLED: 'true',
  });
  expect(result).toEqual({
    valid: false,
    problems: [
      'connect.origin',
      'documents.scanning',
      'documents.storage',
      'googleMapsApiKey',
      'payments.paymentMethodConfiguration',
      'payments.secretKey',
      'payments.webhookSecret',
      'push.delivery',
    ],
  });
});
