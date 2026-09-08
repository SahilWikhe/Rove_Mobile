import { useRef, useState } from 'react';
import { router, Stack } from 'expo-router';
import { ProfileNameForm } from '@rove/mobile-ui/profile-name-form';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, Screen } from '@rove/mobile-ui';
export default function Account() {
  const { profile, api, signOut, updateName, reloadName, cleanupRequired } = useSession();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function logout() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const { rides } = cleanupRequired ? { rides: [] } : await api.rides();
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
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to finish sign-out. Please try again.');
    } finally {
      pending.current = false;
      setBusy(false);
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
      {profile && (
        <ProfileNameForm
          key={profile.id}
          initialName={profile.name}
          save={updateName}
          reload={reloadName}
          disabled={busy}
        />
      )}
      {profile && (
        <Button
          title="Help & support"
          variant="secondary"
          disabled={busy}
          onPress={() => router.push('/support')}
        />
      )}
      {error && <Banner error message={error} />}
      <Button
        title={cleanupRequired ? 'Retry device sign-out' : 'Sign out'}
        variant="secondary"
        loading={busy}
        onPress={() => void logout()}
      />
    </Screen>
  );
}
