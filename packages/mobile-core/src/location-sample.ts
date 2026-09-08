import { BackgroundLocation, type BackgroundLocation as Sample } from '@rove/contracts';

interface DeviceLocation {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy: number | null };
}
/** Send only the newest accurate fix. Never replay batches of old locations. */
export function newestLocation(locations: readonly DeviceLocation[], now: number): Sample | null {
  let newest: Sample | null = null;
  for (const location of locations) {
    if (
      !Number.isFinite(location.timestamp) ||
      location.timestamp < now - 30_000 ||
      location.timestamp > now + 5000
    )
      continue;
    const parsed = BackgroundLocation.safeParse({
      coordinate: { latitude: location.coords.latitude, longitude: location.coords.longitude },
      sampledAt: new Date(location.timestamp).toISOString(),
      accuracyMeters: location.coords.accuracy,
    });
    if (parsed.success && (!newest || parsed.data.sampledAt > newest.sampledAt)) newest = parsed.data;
  }
  return newest;
}
