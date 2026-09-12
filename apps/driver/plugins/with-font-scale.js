/* Expo config plugins run in CommonJS. */
/* eslint-disable @typescript-eslint/no-require-imports */
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

module.exports = function withFontScale(config) {
  return withAndroidManifest(config, (mod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    const changes = new Set((activity.$['android:configChanges'] ?? '').split('|').filter(Boolean));
    // RN 0.86 handles font-scale relayout. Keep the mounted router/form state on this change.
    changes.add('fontScale');
    activity.$['android:configChanges'] = [...changes].join('|');
    return mod;
  });
};
