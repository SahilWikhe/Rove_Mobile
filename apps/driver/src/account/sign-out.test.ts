import { expect, test, vi } from 'vitest';
import { signOutDriver } from './sign-out';
function setup() {
  const sequence: string[] = [];
  return {
    sequence,
    goOffline: vi.fn(async () => {
      sequence.push('offline');
    }),
    profile: vi.fn(async () => {
      sequence.push('confirm');
      return { online: false };
    }),
    stopTracking: vi.fn(async () => {
      sequence.push('stop');
    }),
    clearSession: vi.fn(async () => {
      sequence.push('clear');
    }),
  };
}
test('confirms offline state and stops tracking before clearing account credentials', async () => {
  const deps = setup();
  await signOutDriver(deps);
  expect(deps.sequence).toEqual(['offline', 'confirm', 'stop', 'clear']);
});
test('active-trip rejection preserves the session and tracking', async () => {
  const deps = setup();
  deps.goOffline.mockRejectedValueOnce(new Error('Finish your active trip.'));
  await expect(signOutDriver(deps)).rejects.toThrow('active trip');
  expect(deps.profile).not.toHaveBeenCalled();
  expect(deps.stopTracking).not.toHaveBeenCalled();
  expect(deps.clearSession).not.toHaveBeenCalled();
});
test('uncertain offline confirmation cannot sign out or replay the mutation automatically', async () => {
  const deps = setup();
  deps.profile.mockRejectedValueOnce(new Error('Connection lost'));
  await expect(signOutDriver(deps)).rejects.toThrow('Connection lost');
  expect(deps.goOffline).toHaveBeenCalledOnce();
  expect(deps.clearSession).not.toHaveBeenCalled();
});
test('a stale offline response cannot clear a currently online session', async () => {
  const deps = setup();
  deps.profile.mockResolvedValueOnce({ online: true });
  await expect(signOutDriver(deps)).rejects.toThrow('still online');
  expect(deps.stopTracking).not.toHaveBeenCalled();
  expect(deps.clearSession).not.toHaveBeenCalled();
});
test('native stop failure keeps credentials for recovery and an explicit retry can finish', async () => {
  const deps = setup();
  deps.stopTracking.mockRejectedValueOnce(new Error('Native task could not stop'));
  await expect(signOutDriver(deps)).rejects.toThrow('Native task');
  expect(deps.clearSession).not.toHaveBeenCalled();
  await signOutDriver(deps);
  expect(deps.clearSession).toHaveBeenCalledOnce();
});
