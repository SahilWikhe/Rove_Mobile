import { remainingLocationMs } from '@rove/mobile-core/location-freshness';
import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { RideDetails, RideDriverLocation } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { watchMessagesWhileForeground } from '@rove/mobile-core/message-watch';
import { Banner } from '@rove/mobile-ui';
import { TripMap } from '@rove/mobile-ui/trip-map';

export function RiderTripMap({ ride }: { ride: RideDetails }) {
  const { api, synthetic } = useSession();
  const [location, setLocation] = useState<RideDriverLocation['location']>(null);
  const active = ['matched', 'en_route', 'arrived', 'in_progress', 'interrupted'].includes(ride.state);
  useFocusEffect(
    useCallback(() => {
      setLocation(null);
      if (!active) return;
      let expiry: ReturnType<typeof setTimeout> | undefined;
      const clear = () => {
        clearTimeout(expiry);
        setLocation(null);
      };
      const stop = watchMessagesWhileForeground(
        { subscribeMessages: api.subscribeDriverLocation.bind(api) },
        {
          load: async (signal) => {
            const started = performance.now();
            const result = await api.driverLocation(ride.id, signal);
            return { result, duration: performance.now() - started };
          },
          onData: ({ result, duration }) => {
            clear();
            const sample = result.location;
            const remaining = sample ? remainingLocationMs(sample.validForMs, duration) : 0;
            if (sample && result.rideId === ride.id && remaining > 0 && AppState.currentState === 'active') {
              setLocation(sample);
              expiry = setTimeout(clear, remaining);
            }
          },
          onError: clear,
          intervalMs: 5000,
        },
      );
      const subscription = AppState.addEventListener('change', (state) => {
        if (state !== 'active') clear();
      });
      return () => {
        stop();
        subscription.remove();
        clear();
      };
    }, [api, ride.id, active]),
  );
  if (!ride.pickup || !ride.destination) return null;
  return (
    <>
      <TripMap
        followDriver
        pickup={ride.pickup.coordinate}
        destination={ride.destination.coordinate}
        synthetic={synthetic}
        androidEnabled={!!process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY}
        iosEnabled={!!process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY}
        {...(active && location ? { driver: location } : {})}
      />
      {active && !location && (
        <Banner message="Driver location is unavailable. Check your trip status or contact support." />
      )}
    </>
  );
}
