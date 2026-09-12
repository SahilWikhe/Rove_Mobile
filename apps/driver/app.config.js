module.exports = ({ config }) => ({
  ...config,
  ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID
    ? {
        extra: {
          ...config.extra,
          eas: { ...config.extra?.eas, projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID },
        },
      }
    : {}),
  android: {
    ...config.android,
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
  plugins: [
    ...(config.plugins ?? []),
    ['expo-notifications', { defaultChannel: 'default' }],
    'expo-font',
    './plugins/with-font-scale',
    './plugins/with-navigation',
    [
      'react-native-maps',
      {
        androidGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ?? '',
        iosGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY ?? '',
      },
    ],
  ],
});
