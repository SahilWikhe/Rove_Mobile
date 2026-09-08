export interface PollOptions<T> {
  load: (signal: AbortSignal) => Promise<T>;
  onData: (value: T) => void;
  onError: (error: unknown) => void;
  intervalMs: number;
}
/** Read-only polling. Never use this controller to retry a mutation. */
export function createPoller<T>(options: PollOptions<T>) {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1000)
    throw new Error('Polling interval must be at least one second.');
  let active = false;
  let disposed = false;
  let generation = 0;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  async function run(epoch: number) {
    const controller = new AbortController();
    request = controller;
    let delay = options.intervalMs;
    try {
      const data = await options.load(controller.signal);
      if (disposed || !active || generation !== epoch) return;
      failures = 0;
      options.onData(data);
    } catch (error) {
      if (disposed || !active || generation !== epoch) return;
      failures++;
      delay = Math.min(60_000, options.intervalMs * 2 ** Math.min(failures, 6));
      const retry = (error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
      if (typeof retry === 'number' && Number.isFinite(retry) && retry > 0)
        delay = Math.max(delay, Math.min(retry, 3600) * 1000);
      options.onError(error);
    } finally {
      if (!disposed && active && generation === epoch) {
        request = undefined;
        timer = setTimeout(() => {
          void run(epoch);
        }, delay);
      }
    }
  }
  return {
    setActive(next: boolean) {
      if (disposed || active === next) return;
      active = next;
      generation++;
      clearTimeout(timer);
      request?.abort();
      request = undefined;
      if (active) {
        failures = 0;
        void run(generation);
      }
    },
    dispose() {
      disposed = true;
      active = false;
      generation++;
      clearTimeout(timer);
      request?.abort();
      request = undefined;
    },
  };
}
