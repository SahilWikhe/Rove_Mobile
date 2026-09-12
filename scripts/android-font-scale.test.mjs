import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

for (const role of ['rider', 'driver']) {
  const require = createRequire(new URL(`../apps/${role}/app.config.js`, import.meta.url));
  const plugin = require('./plugins/with-font-scale');
  test(`${role} font-scale plugin preserves existing native activity settings and is idempotent`, async () => {
    const main = {
      $: {
        'android:name': '.MainActivity',
        'android:launchMode': 'singleTask',
        'android:configChanges': 'keyboard|orientation|uiMode',
        'android:exported': 'true',
      },
    };
    const other = { $: { 'android:name': '.OtherActivity', 'android:configChanges': 'screenSize' } };
    const manifest = {
      manifest: { application: [{ $: { 'android:label': 'Fixture' }, activity: [other, main] }] },
    };
    const config = plugin({ name: 'Fixture', slug: 'fixture' });
    for (let i = 0; i < 2; i++)
      await config.mods.android.manifest({
        ...config,
        modRequest: { projectRoot: '/unused-fixture' },
        modResults: manifest,
      });
    assert.deepEqual(main.$, {
      'android:name': '.MainActivity',
      'android:launchMode': 'singleTask',
      'android:configChanges': 'keyboard|orientation|uiMode|fontScale',
      'android:exported': 'true',
    });
    assert.deepEqual(other.$, { 'android:name': '.OtherActivity', 'android:configChanges': 'screenSize' });
  });
  test(`${role} font-scale plugin rejects missing main activity instead of changing another activity`, async () => {
    const config = plugin({ name: 'Fixture', slug: 'fixture' });
    await assert.rejects(
      config.mods.android.manifest({
        ...config,
        modRequest: { projectRoot: '/unused-fixture' },
        modResults: {
          manifest: { application: [{ activity: [{ $: { 'android:name': '.OtherActivity' } }] }] },
        },
      }),
      /MainActivity/,
    );
  });
}
