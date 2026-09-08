import { PaymentProvider } from '../payments/provider';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { theme } from '@rove/mobile-ui';
import { SessionProvider } from '@rove/mobile-core/session';
import {
  useFonts,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
export default function Layout() {
  const [loaded, error] = useFonts({
    Manrope_400Regular,
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
        scheme: 'rove-rider',
        role: 'rider',
        synthetic: process.env.EXPO_PUBLIC_SYNTHETIC === 'true',
      }}
    >
      <PaymentProvider>
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
            <Stack.Screen name="index" options={{ headerShown: false }} />
          </Stack>
        </SafeAreaProvider>
      </PaymentProvider>
    </SessionProvider>
  );
}
