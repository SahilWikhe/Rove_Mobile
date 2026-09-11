import { expect, test, vi } from 'vitest';
import { observeMotionPreference } from './motion-preference';
function fixture() {
  let resolve!: (enabled: boolean) => void;
  let reject!: (error: Error) => void;
  let listener!: (enabled: boolean) => void;
  const pending = new Promise<boolean>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const update = vi.fn();
  const unsubscribe = vi.fn();
  const stop = observeMotionPreference(
    {
      read: () => pending,
      subscribe: (next) => {
        listener = next;
        return unsubscribe;
      },
    },
    update,
  );
  return { resolve, reject, change: (value: boolean) => listener(value), update, unsubscribe, stop };
}
test('reads initial preference and follows changes in both directions', async () => {
  const f = fixture();
  f.resolve(false);
  await Promise.resolve();
  expect(f.update).toHaveBeenLastCalledWith(false);
  f.change(true);
  expect(f.update).toHaveBeenLastCalledWith(true);
  f.change(false);
  expect(f.update).toHaveBeenLastCalledWith(false);
  f.stop();
  expect(f.unsubscribe).toHaveBeenCalledOnce();
});
test('newer system events win over a delayed initial read', async () => {
  const f = fixture();
  f.change(true);
  f.resolve(false);
  await Promise.resolve();
  expect(f.update.mock.calls).toEqual([[true]]);
  f.stop();
});
test('cleanup ignores pending reads and late events', async () => {
  const f = fixture();
  f.stop();
  f.resolve(false);
  f.change(false);
  await Promise.resolve();
  expect(f.update).not.toHaveBeenCalled();
});
test('failed reads preserve the safe default and still accept future updates', async () => {
  const f = fixture();
  f.reject(new Error('unavailable'));
  await Promise.resolve();
  await Promise.resolve();
  expect(f.update).not.toHaveBeenCalled();
  f.change(true);
  expect(f.update).toHaveBeenLastCalledWith(true);
  f.stop();
});
