import { useRef, useState } from 'react';
import { Stack, router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { signOutDriver } from '../account/sign-out';
import { stopBackgroundTracking } from '../tracking/background';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, Screen } from '@rove/mobile-ui';
import { ProfileNameForm } from '@rove/mobile-ui/profile-name-form';

export default function Account() {
  const { profile, api, signOut, updateName, reloadName, cleanupRequired } = useSession();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function leave() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (cleanupRequired) await signOut();
      else
        await signOutDriver({
          goOffline: () => api.availability(false, undefined, Crypto.randomUUID()),
          profile: () => api.driverProfile(),
          stopTracking: stopBackgroundTracking,
          clearSession: signOut,
        });
      router.replace('/');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign-out could not finish. Please try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Account' }} />
      <Copy kind="title">Your space.</Copy>
      {profile ? (
        <>
          <Card>
            <Copy kind="heading">{profile.name}</Copy>
            <Copy kind="muted">Rove driver</Copy>
          </Card>
          <Button
            title="Vehicle & review status"
            variant="secondary"
            disabled={busy}
            onPress={() => router.push('/vehicle')}
          />
          <ProfileNameForm
            key={profile.id}
            initialName={profile.name}
            save={updateName}
            reload={reloadName}
            disabled={busy}
          />
          <Copy kind="muted">
            Changing this name does not change your verified identity, driver approval or payout details.
          </Copy>
          {error && <Banner error message={error} />}
          <Copy kind="muted">
            Signing out takes you offline and stops location sharing. Finish or resolve an active trip first.
          </Copy>
          <Button
            title="Go offline and sign out"
            variant="secondary"
            loading={busy}
            onPress={() => void leave()}
          />
        </>
      ) : (
        <>
          <Copy kind="muted">Sign in to view your profile.</Copy>
          {error && <Banner error message={error} />}
          {cleanupRequired && (
            <Button title="Retry device sign-out" loading={busy} onPress={() => void leave()} />
          )}
        </>
      )}
    </Screen>
  );
}
