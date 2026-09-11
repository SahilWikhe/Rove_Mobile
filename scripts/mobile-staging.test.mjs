import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stagingLaunch } from './mobile-staging.mjs';

test('staging launch overrides inherited synthetic/local backend configuration', () => {
  const result = stagingLaunch('rider', {
    PATH: '/fixture/bin',
    EXPO_PUBLIC_API_URL: 'http://localhost:4085',
    EXPO_PUBLIC_SYNTHETIC: 'true',
    EXPO_PUBLIC_AUTH_CLIENT_ID: 'wrong-client',
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture',
  });
  assert.equal(result.env.EXPO_PUBLIC_API_URL, 'https://rove-api-staging.vercel.app');
  assert.equal(result.env.EXPO_PUBLIC_SYNTHETIC, 'false');
  assert.notEqual(result.env.EXPO_PUBLIC_AUTH_CLIENT_ID, 'wrong-client');
  assert.equal(result.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY, 'pk_test_fixture');
  assert.equal(result.env.PATH, '/fixture/bin');
});
test('rider and driver launch isolated native clients and Metro ports', () => {
  const rider = stagingLaunch('rider', {});
  const driver = stagingLaunch('driver', {});
  assert.notEqual(rider.env.EXPO_PUBLIC_AUTH_CLIENT_ID, driver.env.EXPO_PUBLIC_AUTH_CLIENT_ID);
  assert.notEqual(rider.args.at(-1), driver.args.at(-1));
  assert.ok(rider.args.includes('@rove/rider'));
  assert.ok(driver.args.includes('@rove/driver'));
  for (const role of ['admin', '__proto__', '', undefined]) assert.throws(() => stagingLaunch(role, {}));
});

test('staging refuses live or secret Stripe credentials in mobile configuration', () => {
  for (const key of ['pk_live_fixture', 'sk_test_fixture', 'rk_test_fixture'])
    assert.throws(() => stagingLaunch('rider', { EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: key }));
});
