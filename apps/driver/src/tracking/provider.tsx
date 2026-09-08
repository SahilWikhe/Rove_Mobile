import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useSession } from '@rove/mobile-core/session';
import { stopBackgroundTracking, synchronizeBackgroundTracking } from './background';
import { DriverTracking, type LocationSample } from '@rove/mobile-core/driver-tracking';

const TrackingContext = createContext<string | null>(null);
export const useTrackingError = () => useContext(TrackingContext);

export async function currentPosition(synthetic: boolean): Promise<LocationSample> {
  if (synthetic) {
    return {
      coordinate: { latitude: 35.7796, longitude: -78.6382 },
      sampledAt: new Date().toISOString(),
      accuracyMeters: 5,
    };
  }
  const permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Location permission is required.');
  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  if (location.coords.accuracy === null || location.coords.accuracy > 100 ||
      Date.now() - location.timestamp > 30_000) {
    throw new Error('Waiting for an accurate location. Try again outside or near a window.');
  }
  return {
    coordinate: { latitude: location.coords.latitude, longitude: location.coords.longitude },
    sampledAt: new Date(location.timestamp).toISOString(),
    accuracyMeters: location.coords.accuracy,
  };
}

/** Mounted above the navigator: route changes must never own driver tracking. */
export function DriverTrackingProvider({ children }: PropsWithChildren) {
  const { api, profile, synthetic, ready } = useSession();
  const driverId = profile?.role === 'driver' ? profile.id : null;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    if (!ready) return;
    if (!driverId) {
      void stopBackgroundTracking().catch(() => setError('Location tracking could not be stopped. Restart the app.'));
      return;
    }
    if (!synthetic) {
      let stopped = false;
      let pending = false;
      const update = () => {
        if (AppState.currentState !== 'active' || stopped || pending) return;
        pending = true;
        void synchronizeBackgroundTracking(api, driverId).then(() => {
          if (!stopped) setError(null);
        }).catch(failure => {
          if (!stopped) setError(failure instanceof Error ? failure.message : 'Location tracking is unavailable.');
        }).finally(() => { pending = false; });
      };
      update();
      const subscription = AppState.addEventListener('change', update);
      const timer = setInterval(update, 20_000);
      return () => {
        stopped = true;
        subscription.remove();
        clearInterval(timer);
        void stopBackgroundTracking().catch(() => undefined);
      };
    }
    const tracking = new DriverTracking({
      profile: signal => api.driverProfile(signal),
      position: () => currentPosition(synthetic),
      heartbeat: (sample, signal) => api.heartbeat(sample, signal),
      report: setError,
    });
    const update = () => {
      tracking.setActive(AppState.currentState === 'active');
      void tracking.tick();
    };
    update();
    const subscription = AppState.addEventListener('change', update);
    const timer = setInterval(() => void tracking.tick(), 10_000);
    return () => {
      tracking.setActive(false);
      subscription.remove();
      clearInterval(timer);
    };
  }, [api, driverId, synthetic, ready]);
  return <TrackingContext.Provider value={error}>{children}</TrackingContext.Provider>;
}
