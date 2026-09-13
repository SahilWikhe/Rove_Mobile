import { beforeEach, expect, test, vi } from 'vitest';
import type { ApiClient } from '@rove/mobile-core';
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  position: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: mocks.permission,
  getCurrentPositionAsync: mocks.position,
}));
import { currentPickup } from './current-pickup';
const api = { currentPlace: mocks.resolve } as unknown as ApiClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ status: 'granted' });
  mocks.position.mockResolvedValue({
    timestamp: Date.now(),
    coords: { latitude: 35.8, longitude: -78.6, accuracy: 5 },
  });
  mocks.resolve.mockResolvedValue({ id: 'verified' });
});
test('denied permission never resolves a pickup or obtains GPS', async () => {
  mocks.permission.mockResolvedValue({ status: 'denied' });
  await expect(currentPickup(api, false, new AbortController().signal)).rejects.toThrow('Enter your pickup');
  expect(mocks.position).not.toHaveBeenCalled();
  expect(mocks.resolve).not.toHaveBeenCalled();
});
test('an obsolete pickup lookup cannot start provider resolution', async () => {
  const controller = new AbortController();
  mocks.position.mockImplementation(async () => {
    controller.abort();
    return { timestamp: Date.now(), coords: { latitude: 35.8, longitude: -78.6, accuracy: 5 } };
  });
  await expect(currentPickup(api, false, controller.signal)).rejects.toThrow('cancelled');
  expect(mocks.resolve).not.toHaveBeenCalled();
});
test('stale and inaccurate samples retain manual pickup fallback', async () => {
  for (const [age, accuracy] of [
    [40000, 5],
    [0, 101],
    [-10000, 5],
  ]) {
    mocks.position.mockResolvedValue({
      timestamp: Date.now() - age!,
      coords: { latitude: 35.8, longitude: -78.6, accuracy },
    });
    await expect(currentPickup(api, false, new AbortController().signal)).rejects.toThrow(
      'not accurate enough',
    );
  }
  expect(mocks.resolve).not.toHaveBeenCalled();
});
test('a fresh permitted sample resolves the reviewed provider pickup', async () => {
  const signal = new AbortController().signal;
  await expect(currentPickup(api, false, signal)).resolves.toEqual({ id: 'verified' });
  expect(mocks.resolve).toHaveBeenCalledWith({ latitude: 35.8, longitude: -78.6 }, signal);
});
