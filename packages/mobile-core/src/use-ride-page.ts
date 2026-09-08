import { useCallback, useState } from 'react';
import type { ApiClient } from './index';
import { pollWhileForeground } from './foreground-polling';

/** Mount under an account-and-cursor key. Pass focus to the router's useFocusEffect. */
export function useRidePage(api: ApiClient, before: string | undefined, signedIn: boolean) {
  const [data, setData] = useState<Awaited<ReturnType<ApiClient['rides']>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const focus = useCallback(() => {
    if (!signedIn) return;
    return pollWhileForeground({
      load: (signal) => api.rides(before, signal),
      onData: (page) => {
        setData(page);
        setError(null);
      },
      onError: (failure) => {
        setData(null);
        setError(failure instanceof Error ? failure.message : 'Your trips could not be loaded.');
      },
      intervalMs: 15_000,
    });
    // A deliberate retry re-subscribes, aborting the previous read before starting another.
  }, [api, before, signedIn, refreshVersion]);
  const refresh = () => {
    setData(null);
    setError(null);
    setRefreshVersion((value) => value + 1);
  };
  return { data, error, focus, refresh };
}
