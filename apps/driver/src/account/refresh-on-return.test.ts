import { beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({
  listener: undefined as undefined | ((value: string) => void),
  remove: vi.fn(),
}));
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, listener: (value: string) => void) => {
      state.listener = listener;
      return { remove: state.remove };
    },
  },
}));
import { refreshOnReturn } from './refresh-on-return';
beforeEach(() => state.remove.mockClear());
test('refreshes once after a browser/background return, not on opening or repeated active events', () => {
  const refresh = vi.fn();
  const stop = refreshOnReturn(refresh);
  state.listener?.('active');
  state.listener?.('inactive');
  state.listener?.('background');
  expect(refresh).not.toHaveBeenCalled();
  state.listener?.('active');
  state.listener?.('active');
  expect(refresh).toHaveBeenCalledTimes(1);
  state.listener?.('inactive');
  state.listener?.('active');
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
});
test('blur or account change prevents a queued return from refreshing the old screen', () => {
  const refresh = vi.fn();
  const stop = refreshOnReturn(refresh);
  state.listener?.('background');
  stop();
  state.listener?.('active');
  expect(refresh).not.toHaveBeenCalled();
  expect(state.remove).toHaveBeenCalledOnce();
});
