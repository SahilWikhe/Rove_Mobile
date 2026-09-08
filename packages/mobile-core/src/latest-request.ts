/** Cancels obsolete reads and rejects late results even when a transport ignores abort. */
export function createLatestRequest() {
  let generation = 0;
  let pending: AbortController | null = null;
  function cancel() {
    generation++;
    pending?.abort();
    pending = null;
  }
  function start() {
    cancel();
    const epoch = generation;
    const controller = new AbortController();
    pending = controller;
    return { signal: controller.signal, current: () => generation === epoch && !controller.signal.aborted };
  }
  return {
    cancel,
    start,
    async run<T>(
      load: (signal: AbortSignal) => Promise<T>,
      callbacks: {
        data: (value: T) => void;
        error: (failure: unknown) => void;
        settled: () => void;
      },
    ) {
      const request = start();
      try {
        const value = await load(request.signal);
        if (request.current()) callbacks.data(value);
      } catch (failure) {
        if (request.current()) callbacks.error(failure);
      } finally {
        if (request.current()) callbacks.settled();
      }
    },
  };
}
