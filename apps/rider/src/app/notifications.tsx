import { router, Stack } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { Screen, Copy } from '@rove/mobile-ui';
import { NotificationControls } from '@rove/mobile-ui/notification-controls';
export default function Notifications() {
  const { profile, notifications } = useSession();
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Notifications' }} />
      {profile ? (
        <NotificationControls
          key={profile.id}
          settings={notifications}
          onManageDevices={() => router.push('/notification-devices')}
        />
      ) : (
        <Copy>Sign in to manage notifications.</Copy>
      )}
    </Screen>
  );
}
