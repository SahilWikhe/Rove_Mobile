import { AppState } from 'react-native';
import type { ApiClient } from './index';
import type { PollOptions } from './polling';
/** Event-driven while connected, bounded polling only during transport failure. */
export function watchMessagesWhileForeground<T>(
  api: Pick<ApiClient, 'subscribeMessages'>,
  options: PollOptions<T>,
) {
  let disposed = false,
    active = false,
    connected = false,
    pending = false;
  let generation = 0,
    failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let unsubscribe: (() => void) | undefined;
  const schedule = (delay = options.intervalMs) => {
    clearTimeout(timer);
    if (active && !disposed)
      timer = setTimeout(() => {
        void refresh();
      }, delay);
  };
  async function refresh() {
    if (!active || disposed) return;
    clearTimeout(timer);
    if (controller) {
      pending = true;
      return;
    }
    const epoch = generation,
      request = new AbortController();
    controller = request;
    try {
      const data = await options.load(request.signal);
      if (disposed || !active || epoch !== generation) return;
      failures = 0;
      options.onData(data);
    } catch (error) {
      if (disposed || !active || epoch !== generation) return;
      failures++;
      options.onError(error);
      const retry = (error as { retryAfterSeconds?: number })?.retryAfterSeconds;
      // Honor server throttling even when more invalidations arrive.
      pending = false;
      schedule(
        Math.max(
          Math.min(60000, options.intervalMs * 2 ** Math.min(failures, 6)),
          Math.min(3600, retry ?? 0) * 1000,
        ),
      );
    } finally {
      if (epoch === generation) {
        controller = undefined;
        if (active && !disposed) {
          if (pending && !failures) {
            pending = false;
            void refresh();
          } else if (!connected && !failures) schedule();
        }
      }
    }
  }
  function setActive(next: boolean) {
    if (disposed || next === active) return;
    active = next;
    generation++;
    clearTimeout(timer);
    controller?.abort();
    controller = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    pending = false;
    failures = 0;
    connected = false;
    if (active) {
      unsubscribe = api.subscribeMessages(
        () => {
          if (!failures) void refresh();
        },
        (value) => {
          connected = value;
          if (value && !failures) clearTimeout(timer);
          else if (!value && !controller) schedule();
        },
      );
      void refresh();
    }
  }
  const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
  setActive(AppState.currentState === 'active');
  return () => {
    setActive(false);
    disposed = true;
    subscription.remove();
  };
}
