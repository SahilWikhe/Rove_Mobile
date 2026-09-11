import { spawnSync } from 'node:child_process';
const rates = {
  version: 'synthetic-build-fixture',
  baseCents: 300,
  centsPerKilometer: 90,
  centsPerMinute: 25,
  minimumCents: 700,
  driverBaseCents: 200,
  driverCentsPerKilometer: 70,
  driverCentsPerMinute: 20,
  driverMinimumCents: 550,
};
// Explicit child environment: never inherit cloud/database credentials into build verification.
const result = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
  import assert from 'node:assert/strict';
  import app from './dist/index.mjs';
  import handler from './api/index.mjs';
  import consumer from './api/worker.mjs';
  import { createHmac } from 'node:crypto';
  assert.equal(typeof consumer, 'function');
  const response = await handler.fetch(new Request('https://api.example.test/health/live'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  // An ignored event exercises exact raw-body verification without database or provider calls.
  const payload = JSON.stringify({ id: 'evt_buildprobe', type: 'rove.build_probe',
    created: Math.floor(Date.now() / 1000), livemode: false, data: { object: { id: 'build_probe' } } });
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
    .update(timestamp + '.' + payload).digest('hex');
  const signed = await handler.fetch(new Request('https://api.example.test/webhooks/stripe', {
    method: 'POST', body: payload, headers: { 'content-type': 'application/json',
      'stripe-signature': 't=' + timestamp + ',v1=' + digest }
  }));
  assert.equal(signed.status, 200);
  const tampered = await handler.fetch(new Request('https://api.example.test/webhooks/stripe', {
    method: 'POST', body: payload + ' ', headers: { 'content-type': 'application/json',
      'stripe-signature': 't=' + timestamp + ',v1=' + digest }
  }));
  assert.equal(tampered.status, 400);
  const health = await app.request('/health/live');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal(health.headers.get('cache-control'), 'no-store');
  const unauthorized = await app.request('/v1/me', { headers: { Authorization: 'Bearer synthetic-rider' } });
  assert.equal(unauthorized.status, 401);
  assert.equal((await app.request('/unknown')).status, 404);
  for (const path of ['/__e2e/reset-rate-limits', '/__e2e/shutdown']) {
    assert.equal((await app.request(path, { method: 'POST' })).status, 404);
  }
`,
  ],
  {
    encoding: 'utf8',
    timeout: 15000,
    env: {
      NODE_ENV: 'production',
      CRON_SECRET: 'build-fixture-not-a-real-secret-00000000',
      ROVE_ENVIRONMENT: 'staging',
      DATABASE_URL: 'postgresql://fixture:fixture@db.example.test/rove?sslmode=verify-full',
      OIDC_ISSUER: 'https://identity.example.test/',
      OIDC_AUDIENCE: 'rove-api',
      OIDC_JWKS_URL: 'https://identity.example.test/jwks',
      GOOGLE_MAPS_API_KEY: 'fixture',
      RATE_POLICY_JSON: JSON.stringify(rates),
      SERVICE_AREA_JSON: JSON.stringify({ south: 35, north: 37, west: -80, east: -77 }),
      STRIPE_ACCOUNT_ID: 'acct_fixture',
      STRIPE_MODE: 'test',
      STRIPE_SECRET_KEY: 'rk_test_fixture',
      STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
      STRIPE_PAYMENT_METHOD_CONFIGURATION: 'pmc_fixture',
    },
  },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr || 'Backend bundle verification failed.');
  process.exit(1);
}
console.log('Backend bundle loads on Node and serves health, authenticated boundaries and missing routes.');
