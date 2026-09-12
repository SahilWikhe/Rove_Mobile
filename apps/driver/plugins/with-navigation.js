/* Expo config plugins run in CommonJS. */
/* eslint-disable @typescript-eslint/no-require-imports */
const {
  withAppBuildGradle,
  withProjectBuildGradle,
  withPodfile,
  withInfoPlist,
} = require('expo/config-plugins');

module.exports = function withNavigation(config) {
  config = withPodfile(config, (mod) => {
    const marker = '# Rove Navigation SDK map versions';
    if (!mod.modResults.contents.includes(marker))
      mod.modResults.contents = `${marker}\n$RNMapsGoogleMapsVersion = '10.13.0'\n$RNMapsGoogleMapsUtilsVersion = '7.0.0'\n${mod.modResults.contents}`;
    return mod;
  });
  config = withProjectBuildGradle(config, (mod) => {
    const marker = '// Rove Navigation SDK supplies the Maps classes';
    if (!mod.modResults.contents.includes(marker))
      mod.modResults.contents += `\n${marker}\nallprojects {\n  configurations.configureEach {\n    resolutionStrategy.dependencySubstitution {\n      substitute module('com.google.android.gms:play-services-maps') using module('com.google.android.libraries.navigation:navigation:7.6.1')\n    }\n  }\n}\n`;
    return mod;
  });
  config = withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('desugar_jdk_libs_nio')) {
      mod.modResults.contents += `\nandroid {\n  compileOptions { coreLibraryDesugaringEnabled true }\n}\ndependencies {\n  coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs_nio:2.0.4'\n}\n`;
    }
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults.UIBackgroundModes = [
      ...new Set([...(mod.modResults.UIBackgroundModes ?? []), 'audio', 'location']),
    ];
    return mod;
  });
};
