import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { z } from 'zod';
import type { ApiClient } from './index';
import { pushRegistration } from './push-store';

export function usePushNotifications(options: {
  api: ApiClient;
  apiUrl: string;
  projectId?: string;
  accountId?: string;
  synthetic: boolean;
  sessionEpoch: number;
  isCurrent: (epoch: number) => boolean;
}) {
  const { api, apiUrl, projectId, accountId, synthetic, sessionEpoch, isCurrent } = options;
  const available = !synthetic && Platform.OS !== 'web' && z.uuid().safeParse(projectId).success;
  const journal = useMemo(
    () => (available ? pushRegistration(apiUrl, projectId!) : null),
    [available, apiUrl, projectId],
  );
  const alive = useRef(true);
  const running = useRef(false);
  const [state, setState] = useState<{
    epoch: number;
    enabled: boolean;
    busy: boolean;
    error: string | null;
  }>({ epoch: sessionEpoch, enabled: false, busy: false, error: null });
  const enabled = state.epoch === sessionEpoch && state.enabled;
  const busy = state.epoch === sessionEpoch && state.busy;
  const error = state.epoch === sessionEpoch ? state.error : null;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = useCallback(() => alive.current && isCurrent(sessionEpoch), [isCurrent, sessionEpoch]);
  const run = useCallback(
    async (mode: 'enable' | 'refresh' | 'disable') => {
      if (!journal || !accountId) return;
      if (running.current) throw new Error('Notification settings are updating. Please retry shortly.');
      running.current = true;
      setState({ epoch: sessionEpoch, enabled: false, busy: true, error: null });
      try {
        const store = await journal;
        if (!current()) return;
        if (mode === 'disable') {
          await store.disable(accountId, api, current);
          if (current()) setState((value) => ({ ...value, epoch: sessionEpoch, enabled: false }));
          return;
        }
        const wanted = mode === 'enable' || (await store.wantsEnabled());
        if (!current()) return;
        if (!wanted) {
          await store.disable(accountId, api, current);
          if (current()) setState((value) => ({ ...value, epoch: sessionEpoch, enabled: false }));
          return;
        }
        const notifications = await import('expo-notifications');
        if (!current()) return;
        if (Platform.OS === 'android')
          await notifications.setNotificationChannelAsync('default', {
            name: 'Trip updates',
            importance: notifications.AndroidImportance.HIGH,
          });
        let permission = await notifications.getPermissionsAsync();
        if (!current()) return;
        if (!permission.granted && mode === 'enable' && permission.canAskAgain)
          permission = await notifications.requestPermissionsAsync();
        if (!current()) return;
        const allowed =
          permission.granted || permission.ios?.status === notifications.IosAuthorizationStatus.PROVISIONAL;
        if (!allowed) {
          await store.disable(accountId, api, current);
          if (current()) setState((value) => ({ ...value, epoch: sessionEpoch, enabled: false }));
          if (mode === 'enable')
            throw new Error(
              'Notifications are off in device settings. Enable them there to receive trip updates.',
            );
          return;
        }
        const token = await notifications.getExpoPushTokenAsync({ projectId: projectId! });
        if (!current()) return;
        const registered = await store.enable(
          accountId,
          token.data,
          Platform.OS === 'ios' ? 'ios' : 'android',
          api,
          current,
          mode === 'enable',
        );
        if (current()) setState((value) => ({ ...value, epoch: sessionEpoch, enabled: registered }));
      } catch (failure) {
        if (current()) {
          setState((value) => ({ ...value, epoch: sessionEpoch, enabled: false }));
          setState((value) => ({
            ...value,
            epoch: sessionEpoch,
            error: 'Notification settings could not be confirmed. Retry or check device permissions.',
          }));
        }
        throw failure;
      } finally {
        running.current = false;
        if (current()) setState((value) => ({ ...value, epoch: sessionEpoch, busy: false }));
      }
    },
    [journal, accountId, api, current, projectId, sessionEpoch],
  );
  useEffect(() => {
    if (!journal || !accountId) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const refresh = () => {
      if (!active || AppState.currentState !== 'active') return;
      if (retry) clearTimeout(retry);
      if (running.current) {
        retry = setTimeout(refresh, 250);
        return;
      }
      void run('refresh').catch(() => undefined);
    };
    if (AppState.currentState === 'active') refresh();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    let tokenListener: { remove(): void } | undefined;
    void import('expo-notifications')
      .then((notifications) => {
        if (active) tokenListener = notifications.addPushTokenListener(refresh);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (retry) clearTimeout(retry);
      listener.remove();
      tokenListener?.remove();
    };
  }, [journal, accountId, run]);
  return {
    available,
    enabled: !!accountId && enabled,
    busy,
    error,
    refresh: () => run('refresh'),
    enable: () => run('enable'),
    disable: () => run('disable'),
  };
}
