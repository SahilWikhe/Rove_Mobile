import { expect, test, vi } from 'vitest';
import { createLatestRequest } from './latest-request';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test('an old search finishing last cannot overwrite a new destination search', async () => {
  const requests = createLatestRequest();
  const old = deferred<string[]>();
  const fresh = deferred<string[]>();
  const data = vi.fn(),
    error = vi.fn(),
    settled = vi.fn();
  let signal: AbortSignal | undefined;
  const first = requests.run(
    (value) => {
      signal = value;
      return old.promise;
    },
    { data, error, settled },
  );
  const second = requests.run(() => fresh.promise, { data, error, settled });
  fresh.resolve(['current destination']);
  await second;
  old.resolve(['obsolete pickup']);
  await first;
  expect(signal?.aborted).toBe(true);
  expect(data.mock.calls).toEqual([[['current destination']]]);
  expect(error).not.toHaveBeenCalled();
  expect(settled).toHaveBeenCalledOnce();
});
test('late failure after editing does not show an irrelevant error or stop a newer spinner', async () => {
  const requests = createLatestRequest();
  const old = deferred<string[]>();
  const callbacks = { data: vi.fn(), error: vi.fn(), settled: vi.fn() };
  const running = requests.run(() => old.promise, callbacks);
  requests.cancel();
  old.reject(new Error('old query failed'));
  await running;
  for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
});
test('leaving during a quote prevents applying its response; a subsequent request still works', async () => {
  const requests = createLatestRequest();
  const quote = deferred<string>();
  const callbacks = { data: vi.fn(), error: vi.fn(), settled: vi.fn() };
  const running = requests.run(() => quote.promise, callbacks);
  requests.cancel();
  quote.resolve('old quote');
  await running;
  expect(callbacks.data).not.toHaveBeenCalled();
  await requests.run(async () => 'fresh quote', callbacks);
  expect(callbacks.data).toHaveBeenCalledExactlyOnceWith('fresh quote');
});
