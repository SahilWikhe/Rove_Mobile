import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import { TrackingGrant } from '@rove/contracts';
import { ApiClient, ApiError } from '@rove/mobile-core';
import { newestLocation } from '@rove/mobile-core/location-sample';

const UPDATE_INTERVAL_MS = 3_000;
const TASK = 'rove.driver.location.v1';
const KEY = 'rove.driver.location-grant.v1';
const BLOCKED = 'rove.driver.location-blocked.v1';
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const StoredGrant = TrackingGrant.extend({
  driverId: z.uuid(),
  apiUrl: z.string(),
  nextUploadAt: z.number().int().nonnegative().optional(),
  retryAt: z.number().int().nonnegative().optional(),
});
type StoredGrant = z.infer<typeof StoredGrant>;
let queue: Promise<unknown> = Promise.resolve();
let uploadPending = false;

// OS callbacks and foreground lifecycle changes must not overwrite each other's grant.
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.catch(() => undefined);
  return result;
}
async function readGrant(): Promise<StoredGrant | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const parsed = StoredGrant.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.apiUrl === API_URL ? parsed.data : null;
  } catch {
    return null;
  }
}
function client(grant: StoredGrant) {
  return new ApiClient(API_URL, async () => grant.token);
}
async function stop(grant: StoredGrant | null, revoke: boolean) {
  await SecureStore.deleteItemAsync(KEY);
  if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  if (grant && revoke) {
    try {
      await client(grant).request('/tracking/v1/session', z.object({ revoked: z.boolean() }), {
        method: 'DELETE',
      });
    } catch {
      /* Locally stopped; server also enforces expiry/offline/disabled checks. */
    }
  }
}

// This definition must execute when native launches the JS bundle headlessly.
if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
    if (uploadPending) return;
    uploadPending = true;
    try {
      await serial(async () => {
        const grant = await readGrant();
        if (!grant || Date.parse(grant.expiresAt) <= Date.now()) {
          await stop(grant, false);
          return;
        }
        if (error || !data?.locations || (grant.retryAt ?? 0) > Date.now()) return;
        // Native callbacks may arrive faster than the requested interval (especially on iOS).
        // Persist only a deadline so a new headless process observes the same upload bound.
        const now = Date.now();
        if ((grant.nextUploadAt ?? 0) > now && (grant.nextUploadAt ?? 0) <= now + UPDATE_INTERVAL_MS) return;
        const sample = newestLocation(data.locations, Date.now());
        if (!sample) return;
        grant.nextUploadAt = now + UPDATE_INTERVAL_MS;
        await SecureStore.setItemAsync(KEY, JSON.stringify(grant), {
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        });
        try {
          await client(grant).request('/tracking/v1/location', z.object({ accepted: z.boolean() }), {
            method: 'POST',
            body: sample,
          });
        } catch (failure) {
          if (failure instanceof ApiError && failure.status === 429) {
            // Persist only the pause deadline, never an old location. Native may
            // launch a fresh JS process for the next headless callback.
            const seconds = Math.min(60, Math.max(1, failure.retryAfterSeconds ?? 60));
            await SecureStore.setItemAsync(
              KEY,
              JSON.stringify({ ...grant, retryAt: Date.now() + seconds * 1000 }),
              {
                keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
              },
            );
          }
          if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
            await SecureStore.setItemAsync(BLOCKED, 'true');
            await stop(grant, false);
          }
          // Connection failures never persist or replay location data. The next fresh fix retries.
        }
      });
    } finally {
      uploadPending = false;
    }
  });
}

export async function requestTrackingPermissions() {
  if (Platform.OS === 'web') throw new Error('Use the native driver app for live driving.');
  if (!(await TaskManager.isAvailableAsync()))
    throw new Error('Background tracking requires an installed driver development or release build.');
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') throw new Error('Allow precise location in Settings to go online.');
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted')
    throw new Error('Choose Always / Allow all the time in Location Settings before going online.');
}
export function unblockTracking() {
  return serial(async () => {
    if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(BLOCKED);
  });
}
export function stopBackgroundTracking() {
  return serial(async () => {
    if (Platform.OS === 'web') return;
    await stop(await readGrant(), true);
  });
}
export function synchronizeBackgroundTracking(api: ApiClient, driverId: string) {
  return serial(async () => {
    if (Platform.OS === 'web') throw new Error('Use the native driver app for live driving.');
    const profile = await api.driverProfile();
    let grant = await readGrant();
    if (!profile.online) {
      await stop(grant, true);
      return;
    }
    if (await SecureStore.getItemAsync(BLOCKED))
      throw new Error('Location session ended. Tap Reconnect location to resume on this device.');
    const permission = await Location.getBackgroundPermissionsAsync();
    if (permission.status !== 'granted') {
      await stop(grant, true);
      throw new Error(
        'Background location is unavailable. Restore Always / Allow all the time access in Settings.',
      );
    }
    if (!grant || grant.driverId !== driverId || Date.parse(grant.expiresAt) < Date.now() + 60 * 60 * 1000) {
      if (grant && grant.driverId !== driverId) await stop(grant, true);
      const issued = await api.trackingSession();
      grant = { ...issued, driverId, apiUrl: API_URL };
      // Only the location-only credential is accessible while locked. OIDC tokens stay WHEN_UNLOCKED.
      await SecureStore.setItemAsync(KEY, JSON.stringify(grant), {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    }
    const started = await Location.hasStartedLocationUpdatesAsync(TASK);
    const options = started
      ? await TaskManager.getTaskOptionsAsync<Location.LocationTaskOptions>(TASK)
      : null;
    if (
      !started ||
      options?.timeInterval !== UPDATE_INTERVAL_MS ||
      options?.deferredUpdatesInterval !== UPDATE_INTERVAL_MS
    ) {
      await Location.startLocationUpdatesAsync(TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: UPDATE_INTERVAL_MS,
        distanceInterval: 0,
        deferredUpdatesInterval: UPDATE_INTERVAL_MS,
        pausesUpdatesAutomatically: false,
        activityType: Location.ActivityType.AutomotiveNavigation,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Rove Driver is online',
          notificationBody: 'Sharing your location for ride matching and your active trip.',
          notificationColor: '#D6B26D',
          killServiceOnDestroy: true,
        },
      });
    }
  });
}
