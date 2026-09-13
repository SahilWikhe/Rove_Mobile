import * as Location from 'expo-location';
import type { ApiClient } from '@rove/mobile-core';

export async function currentPickup(api: ApiClient, synthetic: boolean, signal: AbortSignal) {
  if (synthetic) return api.currentPlace({ latitude: 35.7796, longitude: -78.6382 }, signal);
  const permission = await Location.requestForegroundPermissionsAsync();
  if (signal.aborted) throw new Error('Pickup lookup cancelled.');
  if (permission.status !== 'granted') throw new Error('Enter your pickup address to preview this ride.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Location is unavailable. Enter your pickup address.')),
          15000,
        );
      }),
    ]);
    if (signal.aborted) throw new Error('Pickup lookup cancelled.');
    if (
      position.coords.accuracy === null ||
      position.coords.accuracy > 100 ||
      Date.now() - position.timestamp > 30000 ||
      position.timestamp > Date.now() + 5000
    )
      throw new Error('Your location is not accurate enough. Enter your pickup address.');
    return api.currentPlace(
      { latitude: position.coords.latitude, longitude: position.coords.longitude },
      signal,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
