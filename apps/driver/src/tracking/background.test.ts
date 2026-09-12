import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ApiClient } from '@rove/mobile-core';
import type { TaskManagerTaskExecutor } from 'expo-task-manager';

const mocks = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = 'https://api.rove.example';
  return {
    store: new Map<string, string>(),
    started: false,
    options: {} as Record<string, unknown>,
    callback: null as TaskManagerTaskExecutor | null,
    request: vi.fn(async () => ({ accepted: true })),
    backgroundPermission: vi.fn(async () => ({ status: 'granted' })),
    foregroundPermission: vi.fn(async () => ({ status: 'granted' })),
    start: vi.fn(async (_name: string, options: unknown) => {
      mocks.started = true;
      mocks.options = options as Record<string, unknown>;
    }),
    stop: vi.fn(async () => {
      mocks.started = false;
    }),
  };
});
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-task-manager', () => ({
  isTaskDefined: () => false,
  isAvailableAsync: async () => true,
  getTaskOptionsAsync: async () => mocks.options,
  defineTask: (_name: string, callback: TaskManagerTaskExecutor) => {
    mocks.callback = callback;
  },
}));
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => mocks.store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mocks.store.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mocks.store.delete(key);
  },
}));
vi.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  ActivityType: { AutomotiveNavigation: 1 },
  hasStartedLocationUpdatesAsync: async () => mocks.started,
  startLocationUpdatesAsync: mocks.start,
  stopLocationUpdatesAsync: mocks.stop,
  getBackgroundPermissionsAsync: mocks.backgroundPermission,
  requestBackgroundPermissionsAsync: mocks.backgroundPermission,
  requestForegroundPermissionsAsync: mocks.foregroundPermission,
}));
vi.mock('@rove/mobile-core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@rove/mobile-core')>();
  return {
    ...original,
    ApiClient: class {
      request = mocks.request;
    },
  };
});
import { ApiError } from '@rove/mobile-core';
import {
  requestTrackingPermissions,
  stopBackgroundTracking,
  synchronizeBackgroundTracking,
  unblockTracking,
} from './background';

const driverId = '2c999d8c-54ee-4da2-a706-a0be2cdb7238';
const grant = () => ({
  token: 'rt_' + 'a'.repeat(43),
  expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
});
const api = {
  driverProfile: vi.fn(async () => ({ online: true })),
  trackingSession: vi.fn(async () => grant()),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.clear();
  mocks.started = false;
  mocks.request.mockResolvedValue({ accepted: true });
  mocks.backgroundPermission.mockResolvedValue({ status: 'granted' });
  mocks.foregroundPermission.mockResolvedValue({ status: 'granted' });
  api.driverProfile.mockResolvedValue({ online: true });
  api.trackingSession.mockImplementation(async () => grant());
});
function synchronize() {
  return synchronizeBackgroundTracking(api as unknown as ApiClient, driverId);
}
async function deliver() {
  if (!mocks.callback) throw new Error('Task was not registered at module scope');
  await mocks.callback({
    data: {
      locations: [{ timestamp: Date.now(), coords: { latitude: 35.8, longitude: -78.6, accuracy: 5 } }],
    },
    error: null,
    executionInfo: { eventId: 'fixture', taskName: 'rove.driver.location.v1' },
  });
}
test('stores a location-only grant and registers continuous native tracking once', async () => {
  await synchronize();
  await synchronize();
  expect(api.trackingSession).toHaveBeenCalledOnce();
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.start).toHaveBeenCalledWith(
    'rove.driver.location.v1',
    expect.objectContaining({
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      foregroundService: expect.objectContaining({ killServiceOnDestroy: true }),
    }),
  );
  await deliver();
  expect(mocks.request).toHaveBeenCalledWith(
    '/tracking/v1/location',
    expect.anything(),
    expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ coordinate: { latitude: 35.8, longitude: -78.6 } }),
    }),
  );
});
test('going offline stops native updates, deletes credentials and revokes the server grant', async () => {
  await synchronize();
  api.driverProfile.mockResolvedValueOnce({ online: false });
  await synchronize();
  expect(mocks.started).toBe(false);
  expect(mocks.store.has('rove.driver.location-grant.v1')).toBe(false);
  expect(mocks.request).toHaveBeenCalledWith('/tracking/v1/session', expect.anything(), { method: 'DELETE' });
});
test('server revocation blocks automatic rotation until explicit reconnect', async () => {
  await synchronize();
  mocks.request.mockRejectedValueOnce(new ApiError('TRACKING_UNAUTHORIZED', 'Reconnect', 401));
  await deliver();
  expect(mocks.started).toBe(false);
  await expect(synchronize()).rejects.toThrow('Reconnect location');
  expect(api.trackingSession).toHaveBeenCalledOnce();
  await unblockTracking();
  await synchronize();
  expect(api.trackingSession).toHaveBeenCalledTimes(2);
});
test('cleanup wins over an in-flight credential issue', async () => {
  let resolve!: (value: ReturnType<typeof grant>) => void;
  api.trackingSession.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = synchronize();
  await vi.waitFor(() => expect(api.trackingSession).toHaveBeenCalledOnce());
  const stopping = stopBackgroundTracking();
  resolve(grant());
  await Promise.all([pending, stopping]);
  expect(mocks.started).toBe(false);
  expect(mocks.store.has('rove.driver.location-grant.v1')).toBe(false);
});
test('permission denial prevents native startup and removes existing tracking access', async () => {
  await synchronize();
  mocks.backgroundPermission.mockResolvedValue({ status: 'denied' });
  await expect(requestTrackingPermissions()).rejects.toThrow('Always');
  await expect(synchronize()).rejects.toThrow('Background location is unavailable');
  expect(mocks.started).toBe(false);
  expect(mocks.store.has('rove.driver.location-grant.v1')).toBe(false);
});
test('transport failure retains the grant and does not queue the old location', async () => {
  await synchronize();
  mocks.request.mockRejectedValueOnce(new ApiError('CONNECTION_UNAVAILABLE', 'Offline', 0));
  await deliver();
  expect(mocks.started).toBe(true);
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(mocks.store.has('rove.driver.location-grant.v1')).toBe(true);
});

test('does not accumulate callbacks behind a slow upload', async () => {
  await synchronize();
  let resolve!: (value: { accepted: boolean }) => void;
  mocks.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const first = deliver();
  await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
  await deliver();
  expect(mocks.request).toHaveBeenCalledOnce();
  resolve({ accepted: true });
  await first;
});

afterEach(() => vi.restoreAllMocks());
test('throttling persists a pause, keeps tracking access and sends only a fresh fix after retry time', async () => {
  let time = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => time);
  await synchronize();
  mocks.request.mockRejectedValueOnce(new ApiError('RATE_LIMITED', 'Wait', 429, undefined, 30));
  await deliver();
  const stored = JSON.parse(mocks.store.get('rove.driver.location-grant.v1')!);
  expect(stored.retryAt).toBe(time + 30_000);
  expect(stored).not.toHaveProperty('coordinate');
  expect(mocks.started).toBe(true);
  time += 29_000;
  await deliver();
  expect(mocks.request).toHaveBeenCalledOnce();
  time += 1000;
  await deliver();
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.request).toHaveBeenLastCalledWith(
    '/tracking/v1/location',
    expect.anything(),
    expect.objectContaining({ body: expect.objectContaining({ sampledAt: new Date(time).toISOString() }) }),
  );
});
test('a throttled session can still stop and revoke immediately', async () => {
  await synchronize();
  mocks.request.mockRejectedValueOnce(new ApiError('RATE_LIMITED', 'Wait', 429));
  await deliver();
  await stopBackgroundTracking();
  expect(mocks.started).toBe(false);
  expect(mocks.store.has('rove.driver.location-grant.v1')).toBe(false);
  expect(mocks.request).toHaveBeenLastCalledWith('/tracking/v1/session', expect.anything(), {
    method: 'DELETE',
  });
});

test('upgrades an already running slow task without rotating its grant', async () => {
  await synchronize();
  mocks.options = { timeInterval: 10_000, deferredUpdatesInterval: 10_000 };
  await synchronize();
  await synchronize();
  expect(mocks.start).toHaveBeenCalledTimes(2);
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(api.trackingSession).toHaveBeenCalledOnce();
  expect(mocks.options).toMatchObject({ timeInterval: 3000, deferredUpdatesInterval: 3000 });
});

test('bounds rapid native fixes and uploads only the fresh sample after three seconds', async () => {
  let time = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => time);
  await synchronize();
  await deliver();
  for (let i = 0; i < 5; i++) {
    time += 500;
    await deliver();
  }
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(JSON.parse(mocks.store.get('rove.driver.location-grant.v1')!)).not.toHaveProperty('coordinate');
  time += 500;
  await deliver();
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.request).toHaveBeenLastCalledWith(
    '/tracking/v1/location',
    expect.anything(),
    expect.objectContaining({ body: expect.objectContaining({ sampledAt: new Date(time).toISOString() }) }),
  );
});

test('a backwards clock correction cannot stall uploads behind the old cadence deadline', async () => {
  let time = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => time);
  await synchronize();
  await deliver();
  time -= 60_000;
  await deliver();
  expect(mocks.request).toHaveBeenCalledTimes(2);
});
