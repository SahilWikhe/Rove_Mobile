import avatar from '../../assets/account/avatar.png';
import { DriverNavigation } from '../navigation/driver-navigation';
import { View } from 'react-native';
import { AccountProfile, AccountRow, accountContent, accountTitle } from '@rove/mobile-ui/account-layout';
import chevron from '../../assets/account/chevron.png';
import { useRef, useState } from 'react';
import { Stack, router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { signOutDriver } from '../account/sign-out';
import { stopBackgroundTracking } from '../tracking/background';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Copy, Screen } from '@rove/mobile-ui';

export default function Account() {
  const { profile, api, notifications, signOut, cleanupRequired } = useSession();
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
    <Screen
      contentStyle={accountContent}
      footer={profile ? <DriverNavigation active="/account" disabled={busy} /> : undefined}
    >
      <Stack.Screen options={{ title: 'Account', headerShown: false }} />
      <Copy style={accountTitle}>Account</Copy>
      {profile ? (
        <>
          <AccountProfile name={profile.name} subtitle="Rove driver" avatar={avatar} />
          <View style={{ paddingTop: 6 }}>
            <AccountRow
              icon={chevron}
              label="Edit profile"
              disabled={busy}
              onPress={() => router.push('/profile')}
            />
            <AccountRow
              icon={chevron}
              label="Driver setup"
              disabled={busy}
              onPress={() => router.push('/setup')}
            />
            <AccountRow
              icon={chevron}
              label="Vehicle & review status"
              disabled={busy}
              onPress={() => router.push('/vehicle')}
            />
            <AccountRow
              icon={chevron}
              label="Documents & credentials"
              disabled={busy}
              onPress={() => router.push('/documents')}
            />
            <AccountRow
              icon={chevron}
              label="Payout setup"
              disabled={busy}
              onPress={() => router.push('/payouts')}
            />
            <AccountRow
              icon={chevron}
              label="Notifications"
              detail={notifications.available ? (notifications.enabled ? 'On' : 'Off') : 'Unavailable'}
              disabled={busy}
              onPress={() => router.push('/notifications')}
            />
            <AccountRow
              icon={chevron}
              label="Manage notification devices"
              disabled={busy}
              onPress={() => router.push('/notification-devices')}
            />
            <AccountRow
              icon={chevron}
              label="Help & support"
              disabled={busy}
              onPress={() => router.push('/support')}
            />
          </View>
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
