import { useEffect, useState } from 'react';
import { router, Stack } from 'expo-router';
import type { RideDetails } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Copy, EmptyState, Screen } from '@rove/mobile-ui';
export default function Rides() {
  const { api } = useSession(); const [rides, setRides] = useState<RideDetails[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  async function refresh() { setLoading(true); setError(null); try { setRides((await api.rides()).rides); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to load rides.'); } finally { setLoading(false); } }
  useEffect(() => { void refresh(); }, [api]);
  return <Screen><Stack.Screen options={{ title: 'My rides' }} /><Copy kind="title">Your journeys.</Copy>{error && <Banner error message={error} />}<Button title="Refresh" variant="secondary" loading={loading} onPress={() => void refresh()} />{!loading && !error && !rides.length && <EmptyState title="Your first ride is ahead." message="Trips will appear here as soon as you request one." />}{rides.map(ride => <Button key={ride.id} variant="secondary" title={`${ride.destinationArea} · ${ride.state.replaceAll('_', ' ')}`} onPress={() => router.push({ pathname: '/ride', params: { id: ride.id } })} />)}</Screen>;
}
