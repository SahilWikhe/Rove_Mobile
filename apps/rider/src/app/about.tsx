import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import { Button, Card, Copy, Screen } from '@rove/mobile-ui';

export default function About() {
  const version = Constants.expoConfig?.version;
  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: 'About Rove' }} />
      <Copy kind="title">Rove</Copy>
      <Copy>Request a ride, follow your trip and stay in touch with your driver.</Copy>
      <Card>
        <Copy kind="heading">Rove Rider</Copy>
        <Copy kind="muted">{version ? `Version ${version}` : 'Version unavailable'}</Copy>
      </Card>
      <Button title="Help & support" variant="secondary" onPress={() => router.push('/support')} />
    </Screen>
  );
}
