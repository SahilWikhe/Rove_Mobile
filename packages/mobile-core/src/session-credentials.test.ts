import { SessionRefreshUnavailable, refreshWithRecovery } from './auth-refresh';
import { ApiClient } from './index';
import { expect, test, vi } from 'vitest';
import { createSessionCredentials, type SessionTokens } from './session-credentials';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const expired: SessionTokens = { accessToken: 'old', refreshToken: 'refresh-old', expiresAt: 0 };
const renewed: SessionTokens = { accessToken: 'new', refreshToken: 'refresh-new', expiresAt: 100_000 };

test('late refresh success cannot restore credentials or return a token after sign-out', async () => {
  const persist = vi.fn(async () => {});
  const session = createSessionCredentials(persist);
  await session.save(session.epoch(), expired);
  const result = deferred<SessionTokens>();
  const onExpired = vi.fn();
  const request = session.token(() => result.promise, onExpired, 1);
  const signedOut = session.begin();
  await session.save(signedOut, null);
  result.resolve(renewed);
  expect(await request).toBeNull();
  expect(session.peek()).toBeNull();
  expect(persist.mock.calls).toEqual([[expired], [null]]);
  expect(onExpired).not.toHaveBeenCalled();
});

test('late refresh failure does not clear a newer signed-in account', async () => {
  const persist = vi.fn(async () => {});
  const session = createSessionCredentials(persist);
  await session.save(session.epoch(), expired);
  const old = deferred<SessionTokens>();
  const expiredCallback = vi.fn();
  const request = session.token(() => old.promise, expiredCallback, 1);
  const next = session.begin();
  await session.save(next, renewed);
  old.reject(new Error('old provider failure'));
  expect(await request).toBeNull();
  expect(session.peek()).toEqual(renewed);
  expect(expiredCallback).not.toHaveBeenCalled();
});

test('sign-out deletion follows a keychain write already in progress', async () => {
  const writing = deferred<void>();
  const started = deferred<void>();
  let disk: SessionTokens | null = null;
  const session = createSessionCredentials(async (value) => {
    if (value) {
      started.resolve();
      await writing.promise;
    }
    disk = value;
  });
  const oldEpoch = session.epoch();
  const saving = session.save(oldEpoch, renewed);
  await started.promise;
  const next = session.begin();
  const clearing = session.save(next, null);
  expect(session.peek()).toBeNull();
  writing.resolve();
  expect(await saving).toBe(false);
  expect(await clearing).toBe(true);
  expect(disk).toBeNull();
  expect(session.current(oldEpoch)).toBe(false);
});

test('late token exchange is rejected without writing after a newer login begins', async () => {
  const persist = vi.fn(async () => {});
  const session = createSessionCredentials(persist);
  const firstLogin = session.begin();
  const secondLogin = session.begin();
  await session.save(secondLogin, renewed);
  expect(await session.save(firstLogin, expired)).toBe(false);
  expect(persist).toHaveBeenCalledTimes(1);
  expect(session.peek()).toEqual(renewed);
});

test('hydration completing after sign-out cannot restore remembered credentials', async () => {
  const read = deferred<SessionTokens>();
  const started = deferred<void>();
  const session = createSessionCredentials(async () => {});
  const restoring = session.restore(session.epoch(), () => {
    started.resolve();
    return read.promise;
  });
  await started.promise;
  const clearing = session.save(session.begin(), null);
  read.resolve(renewed);
  expect(await restoring).toBe(false);
  await clearing;
  expect(session.peek()).toBeNull();
});

test('concurrent expired-token reads share one refresh and preserve its rotated token', async () => {
  const session = createSessionCredentials(async () => {});
  await session.save(session.epoch(), expired);
  const response = deferred<SessionTokens>();
  const renew = vi.fn(() => response.promise);
  const a = session.token(renew, vi.fn(), 1);
  const b = session.token(renew, vi.fn(), 1);
  response.resolve(renewed);
  expect(await Promise.all([a, b])).toEqual(['new', 'new']);
  expect(renew).toHaveBeenCalledTimes(1);
  expect(session.peek()?.refreshToken).toBe('refresh-new');
});

test('current refresh failure invalidates pending profile work and clears durable credentials', async () => {
  const persist = vi.fn(async () => {});
  const session = createSessionCredentials(persist);
  await session.save(session.epoch(), expired);
  const profileRequestEpoch = session.epoch();
  const onExpired = vi.fn();
  expect(
    await session.token(
      async () => {
        throw new Error('revoked');
      },
      onExpired,
      1,
    ),
  ).toBeNull();
  expect(session.current(profileRequestEpoch)).toBe(false);
  expect(session.peek()).toBeNull();
  expect(onExpired).toHaveBeenCalledOnce();
  expect(persist).toHaveBeenLastCalledWith(null);
});

test('a failed persistence operation does not poison subsequent sign-out deletion', async () => {
  const persist = vi.fn().mockRejectedValueOnce(new Error('keychain busy')).mockResolvedValue(undefined);
  const session = createSessionCredentials(persist);
  await expect(session.save(session.epoch(), renewed)).rejects.toThrow('keychain busy');
  expect(session.peek()).toBeNull();
  await expect(session.save(session.begin(), null)).resolves.toBe(true);
  expect(persist).toHaveBeenLastCalledWith(null);
});

test('old refresh completion cannot clear the new generation’s in-flight refresh', async () => {
  const session = createSessionCredentials(async () => {});
  await session.save(session.epoch(), expired);
  const old = deferred<SessionTokens>();
  const first = session.token(() => old.promise, vi.fn(), 1);
  await session.save(session.begin(), { ...expired, accessToken: 'second-account' });
  const fresh = deferred<SessionTokens>();
  const renew = vi.fn(() => fresh.promise);
  const second = session.token(renew, vi.fn(), 1);
  old.resolve(renewed);
  expect(await first).toBeNull();
  const third = session.token(renew, vi.fn(), 1);
  fresh.resolve(renewed);
  expect(await Promise.all([second, third])).toEqual(['new', 'new']);
  expect(renew).toHaveBeenCalledOnce();
});

test('failed sign-out deletion remains an explicit failure and can be retried', async () => {
  const persist = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('device locked'))
    .mockResolvedValue(undefined);
  const session = createSessionCredentials(persist);
  await session.save(session.epoch(), renewed);
  const epoch = session.begin();
  await expect(session.save(epoch, null)).rejects.toThrow('device locked');
  // Authorization in memory is already gone, despite the durable operation failing.
  expect(await session.token(vi.fn(), vi.fn(), 1)).toBeNull();
  await expect(session.save(session.begin(), null)).resolves.toBe(true);
  expect(persist.mock.calls).toEqual([[renewed], [null], [null]]);
});

test('temporary refresh failure keeps credentials and permits a later successful refresh', async () => {
  const persist = vi.fn(async () => {});
  const session = createSessionCredentials(persist);
  await session.save(session.epoch(), expired);
  const epoch = session.epoch();
  const onExpired = vi.fn();
  const failure = deferred<SessionTokens>();
  const renew = vi.fn(() => refreshWithRecovery(() => failure.promise));
  const first = session.token(renew, onExpired, 1);
  const second = session.token(renew, onExpired, 1);
  const results = Promise.allSettled([first, second]);
  failure.reject(new Error('network down'));
  expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected']);
  expect(renew).toHaveBeenCalledOnce();
  expect(session.peek()).toEqual(expired);
  expect(session.current(epoch)).toBe(true);
  expect(persist).toHaveBeenCalledTimes(1);
  expect(onExpired).not.toHaveBeenCalled();
  expect(await session.token(async () => renewed, onExpired, 1)).toBe('new');
  expect(session.peek()).toEqual(renewed);
});
test('an unavailable refresh prevents the API request rather than sending expired credentials', async () => {
  const session = createSessionCredentials(async () => {});
  await session.save(session.epoch(), expired);
  const transport = vi.fn();
  const api = new ApiClient(
    'https://api.example',
    () =>
      session.token(
        async () => {
          throw new SessionRefreshUnavailable();
        },
        vi.fn(),
        1,
      ),
    transport,
  );
  await expect(api.me()).rejects.toBeInstanceOf(SessionRefreshUnavailable);
  expect(transport).not.toHaveBeenCalled();
});
test('a refresh storage failure still invalidates credentials instead of reusing a rotated grant', async () => {
  const persist = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('keychain locked'))
    .mockResolvedValue(undefined);
  const session = createSessionCredentials(persist);
  await session.save(session.epoch(), expired);
  const onExpired = vi.fn();
  expect(await session.token(async () => renewed, onExpired, 1)).toBeNull();
  expect(session.peek()).toBeNull();
  expect(onExpired).toHaveBeenCalledOnce();
  expect(persist).toHaveBeenLastCalledWith(null);
});
