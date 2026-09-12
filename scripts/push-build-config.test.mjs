import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const role of ['rider', 'driver']) {
  test(`${role} Android push configuration reaches the generated manifest`, () => {
    const root = fileURLToPath(new URL(`../apps/${role}/`, import.meta.url));
    const require = createRequire(new URL(`../apps/${role}/package.json`, import.meta.url));
    const result = spawnSync(
      process.execPath,
      [require.resolve('expo/bin/cli'), 'config', '--type', 'introspect', '--json'],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          EXPO_NO_DOTENV: '1',
          EXPO_NO_TELEMETRY: '1',
          GOOGLE_SERVICES_JSON: '/synthetic/firebase/google-services.json',
          EXPO_PUBLIC_EAS_PROJECT_ID: '00000000-0000-4000-8000-000000000001',
        },
      },
    );
    // Do not expose config output: a developer's environment can include public API keys.
    assert.equal(result.status, 0, 'Expo config introspection failed');
    const config = JSON.parse(result.stdout);
    assert.equal(config.android.package, `co.roveride.${role}`);
    assert.equal(config.android.googleServicesFile, '/synthetic/firebase/google-services.json');
    assert.equal(config.extra.eas.projectId, '00000000-0000-4000-8000-000000000001');
    const application = config._internal.modResults.android.manifest.manifest.application[0];
    const channels = application['meta-data'].filter(
      (item) => item.$['android:name'] === 'com.google.firebase.messaging.default_notification_channel_id',
    );
    assert.equal(channels.length, 1);
    assert.equal(channels[0].$['android:value'], 'default');
    assert.ok(
      config.plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-secure-store'),
    );
  });
}
