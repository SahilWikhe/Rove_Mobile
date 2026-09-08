/** A safe, retryable message; never expose the provider's raw response to the UI. */
export class SessionRefreshUnavailable extends Error {
  constructor() {
    super('We couldn’t refresh your sign-in. Check your connection and try again.');
    this.name = 'SessionRefreshUnavailable';
  }
}
/** Expo TokenError exposes the OAuth error as code. Only invalid_grant proves this grant unusable. */
export async function refreshWithRecovery<T>(renew: () => Promise<T>): Promise<T> {
  try {
    return await renew();
  } catch (failure) {
    if (failure && typeof failure === 'object' && 'code' in failure && failure.code === 'invalid_grant')
      throw failure;
    throw new SessionRefreshUnavailable();
  }
}
