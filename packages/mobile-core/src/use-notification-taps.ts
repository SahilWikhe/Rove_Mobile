import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { createNotificationTaps, type NotificationTarget } from './notification-taps';
import type { ApiClient } from './index';

export function useNotificationTaps(options: {
  ready: boolean;
  accountId: string | undefined;
  role: 'rider' | 'driver';
  api: ApiClient;
  epoch: number;
  isCurrent: (epoch: number) => boolean;
  navigate: ((target: NotificationTarget) => void) | undefined;
}) {
  const { ready, accountId, role, api, epoch, isCurrent, navigate } = options;
  useEffect(() => {
    if (Platform.OS === 'web' || !ready || !navigate) return;
    let alive = true;
    let remove: (() => void) | undefined;
    const current = () => alive && isCurrent(epoch);
    const taps = createNotificationTaps(role, api, () => current() && Boolean(accountId), navigate);
    void import('expo-notifications')
      .then((notifications) => {
        if (!current()) return;
        const handle = (response: import('expo-notifications').NotificationResponse) => {
          if (!current()) return;
          // Consume before any network work, including signed-out taps. Do not carry a
          // previous account's notification across a later sign-in.
          const last = notifications.getLastNotificationResponse();
          if (last?.notification.request.identifier === response.notification.request.identifier)
            notifications.clearLastNotificationResponse();
          if (response.actionIdentifier !== notifications.DEFAULT_ACTION_IDENTIFIER || !accountId) return;
          void taps.open(response.notification.request.content.data).then((result) => {
            if (current() && result === 'unavailable')
              Alert.alert('Update unavailable', 'Open your trips or offers to check the latest details.');
          });
        };
        const subscription = notifications.addNotificationResponseReceivedListener(handle);
        remove = () => subscription.remove();
        const last = notifications.getLastNotificationResponse();
        if (last) handle(last);
      })
      .catch(() => {
        // Older development binaries may lack the native module. Normal app navigation
        // remains available; notification registration reports its own configuration state.
      });
    return () => {
      alive = false;
      taps.cancel();
      remove?.();
    };
  }, [ready, accountId, role, api, epoch, isCurrent, navigate]);
}
