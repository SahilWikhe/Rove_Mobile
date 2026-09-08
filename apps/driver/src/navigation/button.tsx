import { useCallback, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { RideDetails } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button } from '@rove/mobile-ui';
import { navigationTarget, openTripDirections } from './directions';

export function NavigationButton({ ride, disabled }: { ride: RideDetails; disabled: boolean }) {
  const { api, profile } = useSession();
  const pending = useRef<AbortController | null>(null);
  const focused = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (disabled) return;
      focused.current = true;
      const cancel = () => {
        pending.current?.abort();
        pending.current = null;
        setBusy(false);
      };
      const subscription = AppState.addEventListener('change', (state) => {
        if (state !== 'active') cancel();
      });
      return () => {
        focused.current = false;
        subscription.remove();
        cancel();
      };
    }, [disabled]),
  );
  const target = navigationTarget(ride);
  async function navigate() {
    if (pending.current || disabled || !profile || !focused.current || AppState.currentState !== 'active')
      return;
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setError(null);
    try {
      await openTripDirections({
        expected: ride,
        signal: request.signal,
        load: (id, signal) => api.ride(id, signal),
        open: (url) => Linking.openURL(url),
      });
    } catch (failure) {
      if (!request.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'Navigation could not be opened.');
    } finally {
      if (pending.current === request) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  if (!target) return null;
  return (
    <>
      {error && <Banner error message={error} />}
      <Button
        title={`Directions to ${target.leg}`}
        variant="secondary"
        disabled={disabled}
        loading={busy}
        onPress={() => void navigate()}
      />
    </>
  );
}
