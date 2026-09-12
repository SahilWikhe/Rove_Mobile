import { useCallback } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useSession } from '@rove/mobile-core/session';
import { TripSupportForm } from '@rove/mobile-ui/trip-support-form';
export default function Support() {
  const { profile, api } = useSession();
  const { rideId, category } = useLocalSearchParams<{ rideId?: string; category?: string }>();
  const list = useCallback(() => api.supportRequests(), [api]);
  const loadRide = useCallback((id: string, signal: AbortSignal) => api.ride(id, signal), [api]);
  return (
    <>
      <Stack.Screen options={{ title: 'Help & support' }} />
      <TripSupportForm
        key={`${profile?.id}:${rideId}:${category}`}
        signedIn={Boolean(profile)}
        rideId={rideId}
        category={category}
        loadRide={loadRide}
        list={list}
        submit={(input, key) => api.createSupportRequest(input, key)}
        newKey={Crypto.randomUUID}
      />
    </>
  );
}
