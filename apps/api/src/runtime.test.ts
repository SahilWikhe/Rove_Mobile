import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import {
  developmentRates,
  type MapsProvider,
  type PaymentProvider,
  type PaymentCustomerProvider,
  type PaymentWebhookVerifier,
  type PaymentSnapshot,
} from '@rove/server';
import { readRuntimeConfig } from './runtime-config';
import { composeRuntime, createRuntime } from './runtime';
function environment(): Record<string, string | undefined> {
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
  };
}
test('runtime requires explicit payment configuration without leaking credentials in errors', () => {
  for (const key of [
    'STRIPE_ACCOUNT_ID',
    'STRIPE_MODE',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PAYMENT_METHOD_CONFIGURATION',
  ]) {
    const env = environment();
    delete env[key];
    expect(() => readRuntimeConfig(env)).toThrow('Invalid API configuration');
  }
  try {
    readRuntimeConfig({ ...environment(), STRIPE_SECRET_KEY: 'PRIVATE_MALFORMED_KEY' });
    throw new Error('Expected failure');
  } catch (error) {
    expect(String(error)).not.toContain('PRIVATE_MALFORMED_KEY');
    expect(String(error)).toContain('payments.secretKey');
  }
});
test('runtime prevents live/test credential and deployment environment crossover', () => {
  for (const changes of [
    { STRIPE_MODE: 'live' },
    { STRIPE_SECRET_KEY: 'rk_live_fixture' },
    { STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'rk_live_fixture' },
    { ROVE_ENVIRONMENT: 'preview', STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'rk_live_fixture' },
  ])
    expect(() => readRuntimeConfig({ ...environment(), ...changes })).toThrow();
  const production = {
    ...environment(),
    ROVE_ENVIRONMENT: 'production',
    RATE_POLICY_APPROVED_VERSION: 'approved-v1',
    RATE_POLICY_JSON: JSON.stringify({ ...developmentRates, version: 'approved-v1' }),
  };
  expect(() => readRuntimeConfig(production)).toThrow('payments.mode');
  expect(
    readRuntimeConfig({ ...production, STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'rk_live_fixture' })
      .paymentSource,
  ).toBe('acct_fixture:live');
});
test('real runtime starts without migrations or provider calls and rejects synthetic identities', async () => {
  const runtime = createRuntime(environment());
  try {
    const result = await runtime.app.request('/health/live');
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: 'ok' });
    expect(
      (await runtime.app.request('/v1/me', { headers: { Authorization: 'Bearer synthetic-rider' } })).status,
    ).toBe(401);
  } finally {
    await runtime.close();
  }
});
let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  database = await testDatabase();
}, 60000);
afterAll(async () => {
  await database?.close();
});
test.each([false, true])(
  'composed HTTP and payment pipeline preserves cancellation with push enabled=%s',
  async (pushEnabled) => {
    await database.pool.query('TRUNCATE users CASCADE');
    await database.pool.query('TRUNCATE outbox,payment_webhook_events CASCADE');
    const rider = randomUUID();
    await database.pool.query(
      "INSERT INTO users(id,subject,name,role) VALUES($1,'rider','Fixture','rider')",
      [rider],
    );
    const place = {
      id: 'place-fixture',
      label: 'Fixture address',
      area: 'Raleigh',
      coordinate: { latitude: 35.78, longitude: -78.64 },
    };
    const maps: MapsProvider = {
      search: async () => [place],
      resolve: async () => place,
      route: async () => ({ distanceMeters: 6500, durationSeconds: 720 }),
    };
    let payment: PaymentSnapshot;
    const createCustomer = vi.fn(async () => 'cus_fixture');
    const cancel = vi.fn(async () => (payment = { ...payment, status: 'canceled', capturableCents: 0 }));
    const payments: PaymentProvider & PaymentCustomerProvider & PaymentWebhookVerifier = {
      createCustomer,
      create: async (reference) => ({
        payment: (payment = {
          ...reference,
          intentId: 'pi_fixture',
          status: 'requires_capture',
          capturableCents: reference.amountCents,
          receivedCents: 0,
        }),
        clientSecret: 'pi_fixture_secret_private',
      }),
      retrieve: async () => payment,
      cancel,
      capture: async () => {
        throw new Error('unexpected capture');
      },
      refund: async () => {
        throw new Error('unexpected refund');
      },
      session: async () => ({ payment, clientSecret: 'pi_fixture_secret_private' }),
      verifyWebhook: () => ({
        id: 'evt_fixture',
        type: 'payment_intent.amount_capturable_updated',
        created: Math.floor(Date.now() / 1000),
        resourceId: 'pi_fixture',
      }),
    };
    const riderProject = randomUUID();
    const config = readRuntimeConfig({
      ...environment(),
      EXPO_RIDER_PROJECT_ID: riderProject,
      EXPO_DRIVER_PROJECT_ID: randomUUID(),
    });
    const pushSend = vi.fn(async () => ({ status: 'accepted' as const, receiptId: randomUUID() }));
    await database.pool.query(
      `INSERT INTO push_installations(project_id,installation_id,secret_hash,owner_id,token,platform)
    VALUES($1,$2,'fixture',$3,'ExpoPushToken[fixture]','ios')`,
      [riderProject, randomUUID(), rider],
    );
    const runtime = composeRuntime(config, {
      ...(pushEnabled
        ? { pushProvider: { send: pushSend, receipt: async () => ({ status: 'pending' as const }) } }
        : {}),
      database,
      maps,
      payments,
      verifyIdentity: async () => ({ subject: 'rider' }),
    });
    const post = (path: string, body: unknown) =>
      runtime.app.request(path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer fixture',
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify(body),
      });
    const quoteResponse = await post('/v1/quotes', {
      pickup: place,
      destination: place,
      service: 'standard',
    });
    expect(quoteResponse.status).toBe(201);
    const quote = await quoteResponse.json();
    const rideResponse = await post('/v1/ride-requests', { quoteId: quote.id });
    expect(rideResponse.status).toBe(201);
    const ride = await rideResponse.json();
    await runtime.worker.runOnce(10);
    expect(
      (await database.pool.query('SELECT payment_state FROM rides WHERE id=$1', [ride.id])).rows[0]
        .payment_state,
    ).toBe('pending');
    const session = await post(`/v1/rides/${ride.id}/payment-session`, {});
    expect(session.status).toBe(200);
    expect(createCustomer).toHaveBeenCalledOnce();
    const webhook = await runtime.app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'fixture' },
      body: '{}',
    });
    expect(webhook.status).toBe(200);
    await runtime.worker.runOnce(20);
    const funded = (
      await database.pool.query('SELECT version,payment_state FROM rides WHERE id=$1', [ride.id])
    ).rows[0];
    expect(funded.payment_state).toBe('authorized');
    const cancelled = await post(`/v1/rides/${ride.id}/transitions`, {
      state: 'cancelled',
      expectedVersion: funded.version,
    });
    expect(cancelled.status).toBe(200);
    await runtime.worker.runOnce(20);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pushSend).toHaveBeenCalledTimes(pushEnabled ? 1 : 0);
    expect(Boolean(runtime.pushDelivery)).toBe(pushEnabled);
    expect(
      (await database.pool.query('SELECT payment_state FROM rides WHERE id=$1', [ride.id])).rows[0]
        .payment_state,
    ).toBe('released');
    const unhandled = (
      await database.pool.query("SELECT last_error_code FROM outbox WHERE topic='payment.updated'")
    ).rows;
    expect(unhandled.length).toBeGreaterThan(0);
    expect(unhandled.every((row) => row.last_error_code === 'UNKNOWN_JOB_TYPE')).toBe(true);
  },
);

test('Connect onboarding defaults off and requires valid origin and live model acknowledgement', () => {
  expect(readRuntimeConfig(environment()).connect).toBeUndefined();
  for (const value of ['yes', '1'])
    expect(() => readRuntimeConfig({ ...environment(), STRIPE_CONNECT_ONBOARDING_ENABLED: value })).toThrow(
      'connect.enabled',
    );
  for (const origin of [
    'http://api.example.test',
    'https://user:pass@api.example.test',
    'https://api.example.test/path',
  ])
    expect(() =>
      readRuntimeConfig({
        ...environment(),
        STRIPE_CONNECT_ONBOARDING_ENABLED: 'true',
        STRIPE_CONNECT_RETURN_ORIGIN: origin,
      }),
    ).toThrow('connect.origin');
  expect(
    readRuntimeConfig({
      ...environment(),
      STRIPE_CONNECT_ONBOARDING_ENABLED: 'true',
      STRIPE_CONNECT_RETURN_ORIGIN: 'https://api.example.test',
      STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connectfixture',
    }).connect,
  ).toEqual({ origin: 'https://api.example.test', webhookSecret: 'whsec_connectfixture' });
  const live = {
    ...environment(),
    ROVE_ENVIRONMENT: 'production',
    STRIPE_MODE: 'live',
    STRIPE_SECRET_KEY: 'rk_live_fixture',
    RATE_POLICY_APPROVED_VERSION: 'approved-v1',
    RATE_POLICY_JSON: JSON.stringify({ ...developmentRates, version: 'approved-v1' }),
    STRIPE_CONNECT_ONBOARDING_ENABLED: 'true',
    STRIPE_CONNECT_RETURN_ORIGIN: 'https://api.example.test',
    STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connectfixture',
  };
  expect(() => readRuntimeConfig(live)).toThrow('connect.modelApproval');
  expect(
    readRuntimeConfig({ ...live, STRIPE_CONNECT_MODEL_APPROVED: 'recipient-express-platform-responsibility' })
      .connect,
  ).toBeDefined();
});

test('Connect requires a separate valid thin-event signing secret', () => {
  for (const secret of [undefined, '', 'private-invalid', 'whsec_fixture']) {
    expect(() =>
      readRuntimeConfig({
        ...environment(),
        STRIPE_CONNECT_ONBOARDING_ENABLED: 'true',
        STRIPE_CONNECT_RETURN_ORIGIN: 'https://api.example.test',
        STRIPE_CONNECT_WEBHOOK_SECRET: secret,
      }),
    ).toThrow('connect.webhookSecret');
  }
});

test('push registration is off by default and requires two distinct configured app projects', () => {
  expect(readRuntimeConfig(environment()).pushProjects).toBeUndefined();
  const rider = randomUUID(),
    driver = randomUUID();
  expect(
    readRuntimeConfig({ ...environment(), EXPO_RIDER_PROJECT_ID: rider, EXPO_DRIVER_PROJECT_ID: driver })
      .pushProjects,
  ).toEqual({ rider, driver });
  expect(() => readRuntimeConfig({ ...environment(), EXPO_RIDER_PROJECT_ID: rider })).toThrow();
  expect(() =>
    readRuntimeConfig({ ...environment(), EXPO_RIDER_PROJECT_ID: rider, EXPO_DRIVER_PROJECT_ID: rider }),
  ).toThrow();
});

test('push delivery requires an explicit switch, server credential and separate app projects', () => {
  const configured = {
    ...environment(),
    EXPO_RIDER_PROJECT_ID: '00000000-0000-4000-8000-000000000001',
    EXPO_DRIVER_PROJECT_ID: '00000000-0000-4000-8000-000000000002',
  };
  expect(readRuntimeConfig(configured).pushAccessToken).toBeUndefined();
  expect(() => readRuntimeConfig({ ...configured, EXPO_PUSH_DELIVERY_ENABLED: 'yes' })).toThrow();
  expect(() => readRuntimeConfig({ ...configured, EXPO_PUSH_DELIVERY_ENABLED: 'true' })).toThrow();
  expect(() =>
    readRuntimeConfig({
      ...environment(),
      EXPO_PUSH_DELIVERY_ENABLED: 'true',
      EXPO_PUSH_ACCESS_TOKEN: 'synthetic',
    }),
  ).toThrow();
  expect(() =>
    readRuntimeConfig({
      ...configured,
      EXPO_PUSH_DELIVERY_ENABLED: 'true',
      EXPO_PUSH_ACCESS_TOKEN: 'bad\ntoken',
    }),
  ).toThrow();
  expect(
    readRuntimeConfig({
      ...configured,
      EXPO_PUSH_DELIVERY_ENABLED: 'true',
      EXPO_PUSH_ACCESS_TOKEN: 'synthetic',
    }).pushAccessToken,
  ).toBe('synthetic');
});
