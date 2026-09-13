import { afterEach, expect, test, vi } from 'vitest';
import { createReadinessCheck } from './readiness';
afterEach(() => vi.useRealTimers());
test('coalesces concurrent probes and only briefly caches the result', async () => {
  vi.useFakeTimers();
  const probe = vi.fn(async () => undefined);
  const ready = createReadinessCheck(probe);
  expect(await Promise.all(Array.from({ length: 20 }, () => ready()))).toEqual(Array(20).fill(true));
  expect(probe).toHaveBeenCalledTimes(1);
  expect(await ready()).toBe(true);
  expect(probe).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1001);
  probe.mockRejectedValueOnce(new Error('private connection details'));
  expect(await ready()).toBe(false);
  expect(probe).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1001);
  expect(await ready()).toBe(true);
});
test('deadline bounds callers without queuing more work behind a stuck database', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const probe = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const ready = createReadinessCheck(probe);
  const first = ready();
  await vi.advanceTimersByTimeAsync(2000);
  expect(await first).toBe(false);
  const next = ready();
  await vi.advanceTimersByTimeAsync(2000);
  expect(await next).toBe(false);
  expect(probe).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(await ready()).toBe(true);
});
test('synchronous connection errors also return unavailable', async () => {
  expect(
    await createReadinessCheck(() => {
      throw new Error('private host');
    })(),
  ).toBe(false);
});
