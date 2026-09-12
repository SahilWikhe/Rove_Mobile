import { beforeEach, afterEach, test, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({
  current: 'active',
  listener: undefined as undefined | ((state: string) => void),
}));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return state.current;
    },
    addEventListener: (_name: string, listener: (value: string) => void) => {
      state.listener = listener;
      return { remove: vi.fn() };
    },
  },
}));
import { watchMessagesWhileForeground } from './message-watch';
beforeEach(() => {
  vi.useFakeTimers();
  state.current = 'active';
});
afterEach(() => vi.useRealTimers());
function transport() {
  let change: () => void = () => {},
    status: (ready: boolean) => void = () => {};
  const unsubscribe = vi.fn();
  const api = {
    subscribeMessages: vi.fn((changed: () => void, connected: (ready: boolean) => void) => {
      change = changed;
      status = connected;
      connected(false);
      return unsubscribe;
    }),
  };
  return { api, unsubscribe, changed: () => change(), ready: (value: boolean) => status(value) };
}
test('healthy sockets replace repeated polling, failures restore polling, reconnect refreshes immediately', async () => {
  const socket = transport(),
    load = vi.fn().mockResolvedValue('thread');
  const stop = watchMessagesWhileForeground(socket.api, {
    load,
    onData: vi.fn(),
    onError: vi.fn(),
    intervalMs: 3000,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledOnce();
  socket.ready(true);
  socket.changed();
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60000);
  expect(load).toHaveBeenCalledTimes(2);
  socket.changed();
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(3);
  socket.ready(false);
  await vi.advanceTimersByTimeAsync(3000);
  expect(load).toHaveBeenCalledTimes(4);
  socket.ready(true);
  socket.changed();
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(5);
  stop();
  expect(socket.unsubscribe).toHaveBeenCalledOnce();
});
test('an invalidation during an in-flight read is coalesced and cannot be lost', async () => {
  const socket = transport();
  let finish: (data: string) => void = () => {};
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue('new thread');
  const data = vi.fn();
  const stop = watchMessagesWhileForeground(socket.api, {
    load,
    onData: data,
    onError: vi.fn(),
    intervalMs: 3000,
  });
  socket.ready(true);
  socket.changed();
  socket.changed();
  expect(load).toHaveBeenCalledOnce();
  finish('old thread');
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(2);
  expect(data).toHaveBeenLastCalledWith('new thread');
  stop();
});
test('background stops socket usage and ignores late reads; foreground recovers from authoritative data', async () => {
  const socket = transport();
  let finish: (data: string) => void = () => {};
  let signal: AbortSignal | undefined;
  const load = vi
    .fn()
    .mockImplementationOnce((s: AbortSignal) => {
      signal = s;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    })
    .mockResolvedValue('fresh');
  const data = vi.fn();
  const stop = watchMessagesWhileForeground(socket.api, {
    load,
    onData: data,
    onError: vi.fn(),
    intervalMs: 3000,
  });
  state.listener?.('background');
  expect(signal?.aborted).toBe(true);
  expect(socket.unsubscribe).toHaveBeenCalledOnce();
  finish('stale');
  await vi.advanceTimersByTimeAsync(60000);
  expect(data).not.toHaveBeenCalled();
  state.listener?.('active');
  await vi.advanceTimersByTimeAsync(0);
  expect(data).toHaveBeenLastCalledWith('fresh');
  stop();
});
test('server retry-after survives a flood of realtime invalidations', async () => {
  const socket = transport(),
    error = vi.fn();
  const load = vi.fn().mockRejectedValueOnce({ retryAfterSeconds: 60 }).mockResolvedValue('recovered');
  const stop = watchMessagesWhileForeground(socket.api, {
    load,
    onData: vi.fn(),
    onError: error,
    intervalMs: 3000,
  });
  await vi.advanceTimersByTimeAsync(0);
  socket.ready(true);
  for (let i = 0; i < 20; i++) socket.changed();
  await vi.advanceTimersByTimeAsync(59000);
  expect(load).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  expect(load).toHaveBeenCalledTimes(2);
  stop();
});
