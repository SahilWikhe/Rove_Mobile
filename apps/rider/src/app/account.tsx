import { useState } from 'react';
import { router, Stack } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, Screen } from '@rove/mobile-ui';
export default function Account() {
  const { profile, api, signOut } = useSession();
  const [error, setError] = useState<string | null>(null);
  async function logout() {
    try {
      const { rides } = await api.rides();
      if (
        rides.some((ride) =>
          ['searching', 'matched', 'en_route', 'arrived', 'in_progress', 'interrupted'].includes(ride.state),
        )
      ) {
        setError('Finish or resolve your active ride before signing out.');
        return;
      }
      await signOut();
      router.replace('/');
    } catch {
      setError('Unable to confirm your ride status. Please try again.');
    }
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Account' }} />
      <Copy kind="title">Your space.</Copy>
      <Card>
        <Copy kind="label">PROFILE</Copy>
        <Copy kind="heading">{profile?.name ?? 'Sign in to continue'}</Copy>
        <Copy kind="muted">Rove rider</Copy>
      </Card>
      {error && <Banner error message={error} />}
      <Button title="Sign out" variant="secondary" onPress={() => void logout()} />
    </Screen>
  );
}
