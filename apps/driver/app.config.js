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
  plugins: [
    ...(config.plugins ?? []),
    'expo-notifications',
    'expo-font',
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
