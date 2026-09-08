import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createPoller } from './polling';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test('starts only when active and schedules after completion without overlapping reads', async () => {
  const pending = deferred<number>();
  const load = vi.fn().mockReturnValue(pending.promise);
  const onData = vi.fn();
  const poller = createPoller({ load, onData, onError: vi.fn(), intervalMs: 3000 });
  await vi.advanceTimersByTimeAsync(10000);
  expect(load).not.toHaveBeenCalled();
  poller.setActive(true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(load).toHaveBeenCalledTimes(1);
  pending.resolve(1);
  await vi.advanceTimersByTimeAsync(0);
  expect(onData).toHaveBeenCalledWith(1);
  await vi.advanceTimersByTimeAsync(2999);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(2);
  poller.dispose();
});
test('background aborts in-flight reads and stale data cannot overwrite the resumed screen', async () => {
  const old = deferred<string>();
  const fresh = deferred<string>();
  const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const onData = vi.fn();
  const onError = vi.fn();
  const poller = createPoller({ load, onData, onError, intervalMs: 3000 });
  poller.setActive(true);
  const signal = load.mock.calls[0]![0] as AbortSignal;
  poller.setActive(false);
  expect(signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(load).toHaveBeenCalledTimes(1);
  poller.setActive(true);
  fresh.resolve('new');
  old.resolve('old');
  await vi.advanceTimersByTimeAsync(0);
  expect(onData.mock.calls).toEqual([['new']]);
  expect(onError).not.toHaveBeenCalled();
  poller.dispose();
});
test('dispose suppresses late failures and makes reactivation impossible', async () => {
  const pending = deferred<string>();
  const onError = vi.fn();
  const load = vi.fn(() => pending.promise);
  const poller = createPoller({ load, onData: vi.fn(), onError, intervalMs: 1000 });
  poller.setActive(true);
  poller.dispose();
  poller.setActive(true);
  pending.reject(new Error('late'));
  await vi.advanceTimersByTimeAsync(60000);
  expect(onError).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(1);
});
test('backs off transient failures, honors server Retry-After and resets on success', async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce({ retryAfterSeconds: 20 })
    .mockResolvedValue('ok');
  const poller = createPoller({ load, onData: vi.fn(), onError: vi.fn(), intervalMs: 1000 });
  poller.setActive(true);
  await vi.advanceTimersByTimeAsync(1999);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(19999);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1000);
  expect(load).toHaveBeenCalledTimes(4);
  poller.dispose();
});
test('repeated active events do not duplicate timers or reads', async () => {
  const load = vi.fn().mockResolvedValue('ok');
  const poller = createPoller({ load, onData: vi.fn(), onError: vi.fn(), intervalMs: 1000 });
  poller.setActive(true);
  poller.setActive(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(load).toHaveBeenCalledTimes(2);
  poller.setActive(false);
  await vi.advanceTimersByTimeAsync(10000);
  expect(load).toHaveBeenCalledTimes(2);
  poller.dispose();
});
