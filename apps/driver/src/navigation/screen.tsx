import { router, Stack } from 'expo-router';
import { Button, Copy, Screen } from '@rove/mobile-ui';
export default function NavigationScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Directions' }} />
      <Screen>
        <Copy>Turn-by-turn directions are available in the Rove Driver iOS and Android apps.</Copy>
        <Button title="Back to trip" onPress={() => router.back()} />
      </Screen>
    </>
  );
}
