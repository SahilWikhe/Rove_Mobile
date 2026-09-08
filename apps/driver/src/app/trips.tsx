import { useEffect, useState } from 'react';
import { router, Stack } from 'expo-router';
import type { RideDetails } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Copy, EmptyState, Screen } from '@rove/mobile-ui';
export default function Trips() {
  const { api } = useSession();
  const [rides, setRides] = useState<RideDetails[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void api
      .rides()
      .then((result) => {
        if (alive) setRides(result.rides);
      })
      .catch((failure) => {
        if (alive) setError(failure.message);
      });
    return () => {
      alive = false;
    };
  }, [api]);
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Your trips' }} />
      <Copy kind="title">Every mile,{'\n'}in one place.</Copy>
      {error && <Banner error message={error} />}
      {!rides.length && !error && (
        <EmptyState
          title="Your journey starts here."
          message="Accepted trips appear here with their current status."
        />
      )}
      {rides.map((ride) => (
        <Button
          key={ride.id}
          variant="secondary"
          title={`${ride.destinationArea} · ${ride.state.replaceAll('_', ' ')}`}
          onPress={() => router.push({ pathname: '/trip', params: { id: ride.id } })}
        />
      ))}
    </Screen>
  );
}
