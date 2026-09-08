export interface SessionTokens {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt: number;
}

/** Coordinates async auth work and native persistence. No provider or React dependencies. */
export function createSessionCredentials(persist: (tokens: SessionTokens | null) => Promise<void>) {
  let generation = 0;
  let tokens: SessionTokens | null = null;
  let writes: Promise<unknown> = Promise.resolve();
  let refresh: { generation: number; promise: Promise<string | null> } | null = null;
  const current = (epoch: number) => epoch === generation;
  function begin() {
    generation++;
    tokens = null;
    refresh = null;
    return generation;
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = writes.then(operation, operation);
    // A failed keychain write must not prevent a subsequent delete/retry.
    writes = result.catch(() => undefined);
    return result;
  }
  async function save(epoch: number, value: SessionTokens | null) {
    return serial(async () => {
      if (!current(epoch)) return false;
      await persist(value);
      if (!current(epoch)) return false;
      tokens = value;
      return true;
    });
  }
  async function restore(epoch: number, read: () => Promise<SessionTokens | null>) {
    return serial(async () => {
      if (!current(epoch)) return false;
      const value = await read();
      if (!current(epoch)) return false;
      tokens = value;
      return value !== null;
    });
  }
  async function token(
    renew: (previous: SessionTokens) => Promise<SessionTokens | null>,
    onExpired: () => void,
    now = Date.now(),
  ): Promise<string | null> {
    const previous = tokens;
    if (!previous) return null;
    if (previous.expiresAt > now + 30_000) return previous.accessToken;
    if (!previous.refreshToken) return null;
    if (refresh?.generation === generation) return refresh.promise;
    const epoch = generation;
    const promise = (async () => {
      try {
        const renewed = await renew(previous);
        if (!current(epoch) || !renewed) return null;
        if (!(await save(epoch, renewed))) return null;
        return current(epoch) ? renewed.accessToken : null;
      } catch {
        if (!current(epoch)) return null;
        // Expiration invalidates profile/registration work from this session too.
        const clearedEpoch = begin();
        onExpired();
        await save(clearedEpoch, null);
        return null;
      } finally {
        if (refresh?.generation === epoch) refresh = null;
      }
    })();
    refresh = { generation: epoch, promise };
    return promise;
  }
  return { begin, current, epoch: () => generation, peek: () => tokens, save, restore, token };
}
