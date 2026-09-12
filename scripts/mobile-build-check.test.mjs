import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    EAS_BUILD_PROFILE: 'unknown',
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

function productionFixture(role, platform) {
  const approved = {
    EXPO_PUBLIC_API_URL: 'https://api.production.example',
    EXPO_PUBLIC_AUTH_ISSUER: 'https://production-example.auth0.com',
    EXPO_PUBLIC_AUTH_AUDIENCE: 'https://api.production.example',
    EXPO_PUBLIC_AUTH_CLIENT_ID: `production-${role}-client`,
    EXPO_PUBLIC_EAS_PROJECT_ID: '22222222-2222-4222-8222-222222222222',
  };
  return {
    configuration: { [role]: approved },
    env: {
      ...fixture(role, platform),
      ...approved,
      EAS_BUILD_PROFILE: 'production',
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture',
    },
  };
}
test('production builds require an explicitly populated release configuration', () => {
  for (const role of ['rider', 'driver']) {
    const { env } = productionFixture(role, 'ios');
    assert.throws(() => checkMobileBuild(role, env), /Invalid production build settings/);
  }
});
test('production profiles are store builds without inherited staging configuration', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rove-firebase-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const role of ['rider', 'driver']) {
    const profile = JSON.parse(readFileSync(new URL(`../apps/${role}/eas.json`, import.meta.url))).build
      .production;
    assert.equal(profile.environment, 'production');
    assert.equal(profile.distribution, 'store');
    assert.equal(profile.android.buildType, 'app-bundle');
    assert.equal(profile.extends, undefined);
    assert.deepEqual(profile.env, { EXPO_PUBLIC_SYNTHETIC: 'false' });
    for (const platform of ['ios', 'android']) {
      const { env, configuration } = productionFixture(role, platform);
      if (platform === 'android') {
        const file = join(root, `${role}.json`);
        writeFileSync(file, JSON.stringify(firebase(role)));
        env.GOOGLE_SERVICES_JSON = file;
        configuration[role].ANDROID_FIREBASE_PROJECT_ID = 'rove-production';
      }
      checkMobileBuild(role, env, configuration);
    }
  }
});
test('production refuses synthetic, test payments, missing SDK keys and unapproved endpoints without exposing values', () => {
  const { env, configuration } = productionFixture('rider', 'ios');
  for (const [key, value] of Object.entries({
    EXPO_PUBLIC_SYNTHETIC: 'true',
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_privatefixture',
    EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY: '',
    EXPO_PUBLIC_API_URL: 'https://private-wrong.example',
    EXPO_PUBLIC_AUTH_CLIENT_ID: 'private-wrong-client',
    EXPO_PUBLIC_EAS_PROJECT_ID: '',
  })) {
    assert.throws(
      () => checkMobileBuild('rider', { ...env, [key]: value }, configuration),
      (error) => error.message.includes(key) && !error.message.includes('private'),
    );
  }
});
test('a production manifest cannot approve staging identity, staging API or insecure URLs', () => {
  const { env, configuration } = productionFixture('rider', 'ios');
  const staging = fixture('rider', 'ios');
  for (const key of [
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_AUTH_ISSUER',
    'EXPO_PUBLIC_AUTH_AUDIENCE',
    'EXPO_PUBLIC_AUTH_CLIENT_ID',
  ]) {
    assert.throws(
      () =>
        checkMobileBuild(
          'rider',
          { ...env, [key]: staging[key] },
          { rider: { ...configuration.rider, [key]: staging[key] } },
        ),
      new RegExp(key),
    );
  }
  for (const url of [
    staging.EXPO_PUBLIC_API_URL + '/',
    'http://api.example',
    'https://localhost',
    'https://user:password@api.example',
    'https://api.example?token=private',
  ]) {
    assert.throws(
      () =>
        checkMobileBuild(
          'rider',
          { ...env, EXPO_PUBLIC_API_URL: url },
          { rider: { ...configuration.rider, EXPO_PUBLIC_API_URL: url } },
        ),
      /EXPO_PUBLIC_API_URL/,
    );
  }
});

function firebase(role, project = 'rove-production') {
  return {
    project_info: { project_id: project },
    client: [
      {
        client_info: {
          mobilesdk_app_id: '1:1234567890:android:0123456789abcdef',
          android_client_info: { package_name: `co.roveride.${role}` },
        },
      },
    ],
  };
}
test('Android validates Firebase package and approved production project without exposing file data', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rove-firebase-validation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'private-config.json');
  const { env, configuration } = productionFixture('rider', 'android');
  configuration.rider.ANDROID_FIREBASE_PROJECT_ID = 'rove-production';
  assert.throws(() => checkMobileBuild('rider', env, configuration), /GOOGLE_SERVICES_JSON/);
  env.GOOGLE_SERVICES_JSON = file;
  for (const value of [
    firebase('driver'),
    firebase('rider', 'private-staging-project'),
    { type: 'service_account', private_key: 'private-do-not-print' },
    { ...firebase('rider'), private_key_id: 'private-do-not-print' },
    {},
    null,
    'private-invalid-content',
  ]) {
    writeFileSync(file, JSON.stringify(value));
    assert.throws(
      () => checkMobileBuild('rider', env, configuration),
      (error) => error.message.includes('GOOGLE_SERVICES_JSON') && !error.message.includes('private'),
    );
  }
  writeFileSync(file, 'private-malformed-json');
  assert.throws(() => checkMobileBuild('rider', env, configuration), /GOOGLE_SERVICES_JSON/);
  writeFileSync(file, 'x'.repeat(1024 * 1024 + 1));
  assert.throws(() => checkMobileBuild('rider', env, configuration), /GOOGLE_SERVICES_JSON/);
  writeFileSync(file, JSON.stringify(firebase('rider')));
  checkMobileBuild('rider', env, configuration);
  delete configuration.rider.ANDROID_FIREBASE_PROJECT_ID;
  assert.throws(() => checkMobileBuild('rider', env, configuration), /ANDROID_FIREBASE_PROJECT_ID/);
  const staging = { ...fixture('rider', 'android'), GOOGLE_SERVICES_JSON: file };
  checkMobileBuild('rider', staging);
  writeFileSync(file, JSON.stringify(firebase('driver')));
  assert.throws(() => checkMobileBuild('rider', staging), /GOOGLE_SERVICES_JSON/);
  // iOS uses APNs, and does not consume an Android client file.
  checkMobileBuild('rider', { ...fixture('rider', 'ios'), GOOGLE_SERVICES_JSON: '/missing-private-file' });
});
