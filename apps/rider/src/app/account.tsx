import { useRef, useState } from 'react';
import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import { AccountProfile, AccountRow, accountContent, accountTitle } from '@rove/mobile-ui/account-layout';
import { HomeNavigation } from '../navigation/rider-navigation';
import chevron from '../../assets/account/chevron.png';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Copy, Screen } from '@rove/mobile-ui';
export default function Account() {
  const { profile, api, notifications, signOut, cleanupRequired } = useSession();
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
    <Screen
      contentStyle={accountContent}
      footer={profile ? <HomeNavigation active="/account" disabled={busy} /> : undefined}
    >
      <Stack.Screen options={{ title: 'Account', headerShown: false }} />
      <Copy style={accountTitle}>Account</Copy>
      <AccountProfile name={profile?.name ?? 'Sign in to continue'} subtitle="Rove member" />
      {profile && (
        <View style={{ paddingTop: 8 }}>
          <AccountRow
            icon={chevron}
            label="Edit profile"
            disabled={busy}
            onPress={() => router.push('/profile')}
          />
          <AccountRow
            icon={chevron}
            label="Payment methods"
            disabled={busy}
            onPress={() => router.push('/payment-methods')}
          />
          <AccountRow
            icon={chevron}
            label="Saved places"
            disabled={busy}
            onPress={() => router.push('/saved-places')}
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
