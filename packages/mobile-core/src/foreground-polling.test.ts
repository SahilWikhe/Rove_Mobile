import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({
  currentState: 'background',
  listener: undefined as undefined | ((value: string) => void),
  remove: vi.fn(),
}));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return state.currentState;
    },
    addEventListener: (_name: string, listener: (value: string) => void) => {
      state.listener = listener;
      return { remove: state.remove };
    },
  },
}));
import { pollWhileForeground } from './foreground-polling';
beforeEach(() => {
  vi.useFakeTimers();
  state.currentState = 'background';
  state.remove.mockClear();
});
afterEach(() => vi.useRealTimers());
test('focus starts no requests in background, resumes immediately and cleans up the native subscription', async () => {
  const load = vi.fn().mockResolvedValue('ride');
  const stop = pollWhileForeground({ load, onData: vi.fn(), onError: vi.fn(), intervalMs: 3000 });
  expect(load).not.toHaveBeenCalled();
  state.listener?.('active');
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  state.listener?.('inactive');
  await vi.advanceTimersByTimeAsync(10000);
  expect(load).toHaveBeenCalledTimes(1);
  state.listener?.('active');
  expect(load).toHaveBeenCalledTimes(2);
  stop();
  expect(state.remove).toHaveBeenCalledOnce();
  state.listener?.('active');
  await vi.advanceTimersByTimeAsync(10000);
  expect(load).toHaveBeenCalledTimes(2);
});
test('an already-active screen loads immediately and focus cleanup aborts its request', () => {
  state.currentState = 'active';
  let signal: AbortSignal | undefined;
  const stop = pollWhileForeground({
    load: (input) => {
      signal = input;
      return new Promise(() => {});
    },
    onData: vi.fn(),
    onError: vi.fn(),
    intervalMs: 3000,
  });
  expect(signal?.aborted).toBe(false);
  stop();
  expect(signal?.aborted).toBe(true);
});
