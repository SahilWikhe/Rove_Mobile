import { useEffect, useRef, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import type { RideDetails } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, Money, RouteSummary, Screen } from '@rove/mobile-ui';
const titles: Record<RideDetails['state'], string> = {
  searching: 'Finding your ride.', matched: 'Your driver is confirmed.', en_route: 'On the way to you.', arrived: 'Your driver has arrived.', in_progress: 'You’re on your way.', completed: 'You’ve arrived.',
  cancelled: 'Ride cancelled.', no_driver_found: 'No drivers available right now.', no_show: 'Pickup was not completed.', interrupted: 'Your trip needs attention.', terminated: 'Your trip has ended.',
};
export default function Ride() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { api } = useSession();
  const [ride, setRide] = useState<RideDetails | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const cancelKey = useRef<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try { const next = await api.ride(id); if (!stopped) { setRide(next); setError(null); } }
      catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : 'Tracking is unavailable.'); }
      finally { if (!stopped) timer = setTimeout(refresh, 5000); }
    }
    void refresh(); return () => { stopped = true; clearTimeout(timer); };
  }, [api, id]);
  async function cancel() {
    if (!ride) return; setBusy(true);
    try { cancelKey.current ??= Crypto.randomUUID(); await api.transition(ride.id, 'cancelled', ride.version, cancelKey.current); setRide(await api.ride(id)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Cancellation could not be confirmed.'); }
    finally { setBusy(false); }
  }
  return <Screen><Stack.Screen options={{ title: 'Your ride' }} />{error && <Banner error message={error} />}{ride ? <><Copy kind="title">{titles[ride.state]}</Copy><RouteSummary pickup={ride.pickup?.label ?? ride.pickupArea} destination={ride.destination?.label ?? ride.destinationArea} />{ride.driver && <Card><Copy kind="label">YOUR DRIVER</Copy><Copy kind="heading">{ride.driver.name}</Copy></Card>}<Card><Money cents={ride.fare.amount} label="FARE" /><Copy kind="muted">Payment: {ride.paymentState.replaceAll('_', ' ')}</Copy></Card>{['searching', 'matched', 'en_route', 'arrived'].includes(ride.state) && (confirmCancel ? <Card><Copy kind="heading">Cancel this ride?</Copy><Copy kind="muted">Your driver search or assignment will end.</Copy><Button title="Confirm cancellation" variant="danger" loading={busy} onPress={() => void cancel()} /><Button title="Keep ride" variant="secondary" disabled={busy} onPress={() => setConfirmCancel(false)} /></Card> : <Button title="Cancel ride" variant="secondary" onPress={() => setConfirmCancel(true)} />)}</> : <Copy kind="muted">Loading your ride…</Copy>}</Screen>;
}
