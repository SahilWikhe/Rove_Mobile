import { useCallback } from 'react';
import { Stack } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useSession } from '@rove/mobile-core/session';
import { Screen, Copy } from '@rove/mobile-ui';
import { NotificationDevices } from '@rove/mobile-ui/notification-devices';
export default function Devices() {
  const { api, profile, notifications } = useSession();
  const list = useCallback((signal?: AbortSignal) => api.notificationDevices(signal), [api]);
  const revoke = useCallback(
    async (device: { id: string; revision: number }, mutationId: string) => {
      const result = await api.revokeNotificationDevice(device.id, {
        expectedRevision: device.revision,
        mutationId,
      });
      await notifications.refresh().catch(() => undefined);
      return result;
    },
    [api, notifications],
  );
  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: 'Notification devices' }} />
      {profile ? (
        <NotificationDevices key={profile.id} list={list} revoke={revoke} newKey={Crypto.randomUUID} />
      ) : (
        <Copy>Sign in to manage notification devices.</Copy>
      )}
    </Screen>
  );
}
