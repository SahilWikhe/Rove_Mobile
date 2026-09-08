module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    [
      'react-native-maps',
      {
        androidGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ?? '',
        iosGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY ?? '',
      },
    ],
  ],
});
