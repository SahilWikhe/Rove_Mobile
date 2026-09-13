/** One bounded, read-only database probe per instance; never accumulate timed-out queries. */
export function createReadinessCheck(probe: () => Promise<unknown>) {
  let pending: Promise<boolean> | undefined;
  let cached: { at: number; ready: boolean } | undefined;
  return async (): Promise<boolean> => {
    if (cached && performance.now() - cached.at < 1000) return cached.ready;
    if (!pending) {
      pending = Promise.resolve()
        .then(probe)
        .then(
          () => true,
          () => false,
        )
        .then((ready) => {
          cached = { at: performance.now(), ready };
          pending = undefined;
          return ready;
        });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 2000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}
