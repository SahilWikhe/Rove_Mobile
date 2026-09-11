import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkMobileBuild } from './mobile-build-check.mjs';
function fixture(role, platform) {
  return {
    ...JSON.parse(readFileSync(new URL(`../apps/${role}/eas.json`, import.meta.url))).build.staging.env,
    EAS_BUILD_PROFILE: 'staging',
    EAS_BUILD_PLATFORM: platform,
    EXPO_PUBLIC_EAS_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
    EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY: 'AIza' + 'a'.repeat(35),
    EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: 'AIza' + 'b'.repeat(35),
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture',
  };
}
test('both staging apps validate each native platform', () => {
  for (const role of ['rider', 'driver'])
    for (const platform of ['ios', 'android']) checkMobileBuild(role, fixture(role, platform));
});
test('rejects environment crossover, synthetic mode and missing credentials without disclosing values', () => {
  for (const [key, value] of Object.entries({
    EXPO_PUBLIC_API_URL: 'http://localhost:4080',
    EXPO_PUBLIC_SYNTHETIC: 'true',
    EXPO_PUBLIC_AUTH_CLIENT_ID: 'private-wrong-client',
    EXPO_PUBLIC_EAS_PROJECT_ID: '',
    EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY: '',
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_privatefixture',
    EAS_BUILD_PROFILE: 'production',
    EAS_BUILD_PLATFORM: 'web',
  })) {
    assert.throws(
      () => checkMobileBuild('rider', { ...fixture('rider', 'ios'), [key]: value }),
      (error) => error.message.includes(key) && !error.message.includes('private'),
    );
  }
});
test('requires the key for the build platform, not the other SDK', () => {
  const env = fixture('driver', 'android');
  delete env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY;
  assert.throws(() => checkMobileBuild('driver', env), /ANDROID_KEY/);
});
