import { DriverTrackingProvider } from '../tracking/provider';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { theme } from '@rove/mobile-ui';
import { SessionProvider } from '@rove/mobile-core/session';
import {
  useFonts,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
export default function Layout() {
  const [loaded, error] = useFonts({
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });
  if (!loaded && !error) return null;
  return (
    <SessionProvider
      config={{
        apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
        issuer: process.env.EXPO_PUBLIC_AUTH_ISSUER ?? '',
        clientId: process.env.EXPO_PUBLIC_AUTH_CLIENT_ID ?? '',
        audience: process.env.EXPO_PUBLIC_AUTH_AUDIENCE ?? '',
        scheme: 'rove-driver',
        role: 'driver',
        onNotificationOpen: router.push,
        ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID
          ? { pushProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID }
          : {}),
        synthetic: process.env.EXPO_PUBLIC_SYNTHETIC === 'true',
      }}
    >
      <DriverTrackingProvider>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.background },
              headerTintColor: theme.text,
              contentStyle: { backgroundColor: theme.background },
              headerBackTitle: 'Back',
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false, animation: 'none' }} />
            <Stack.Screen name="drive" options={{ animation: 'none' }} />
            <Stack.Screen name="trips" options={{ animation: 'none' }} />
            <Stack.Screen name="earnings" options={{ animation: 'none' }} />
            <Stack.Screen name="account" options={{ animation: 'none' }} />
          </Stack>
        </SafeAreaProvider>
      </DriverTrackingProvider>
    </SessionProvider>
  );
}
