import { useTrackingError } from '../tracking/provider';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import type { RideDetails } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, RouteSummary, Screen } from '@rove/mobile-ui';
const actions = {
  matched: ['en_route', 'Head to pickup'],
  en_route: ['arrived', 'I’ve arrived'],
  arrived: ['in_progress', 'Start trip'],
  in_progress: ['completed', 'Complete trip'],
} as const;
export default function Trip() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const trackingError = useTrackingError();
  const [ride, setRide] = useState<RideDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const operation = useRef<{ state: RideDetails['state']; version: number; key: string } | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        if (AppState.currentState === 'active') {
          const updated = await api.ride(id);
          if (!stopped) setRide(updated);
        }
      } catch (failure) {
        if (!stopped)
          setError(failure instanceof Error ? failure.message : 'Trip information is unavailable.');
      } finally {
        if (!stopped) timer = setTimeout(refresh, 4000);
      }
    }
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, id]);
  const action = ride && ride.state in actions ? actions[ride.state as keyof typeof actions] : null;
  async function transition() {
    if (!ride || !action) return;
    setBusy(true);
    setError(null);
    if (
      !operation.current ||
      operation.current.state !== action[0] ||
      operation.current.version !== ride.version
    )
      operation.current = { state: action[0], version: ride.version, key: Crypto.randomUUID() };
    try {
      await api.transition(id, operation.current.state, operation.current.version, operation.current.key);
      setRide(await api.ride(id));
      setConfirm(false);
      operation.current = null;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Trip update was not confirmed.');
    } finally {
      setBusy(false);
    }
  }
  const destination = ride?.state === 'in_progress' ? ride.destination : ride?.pickup;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Active trip' }} />
      {error && <Banner error message={error} />}
      {trackingError && <Banner error message={trackingError} />}
      {ride ? (
        <>
          <Copy kind="label">{ride.state.replaceAll('_', ' ').toUpperCase()}</Copy>
          <Copy kind="title">
            {ride.state === 'completed'
              ? 'Trip complete.'
              : ride.state === 'arrived'
                ? 'Waiting at pickup.'
                : ride.state === 'in_progress'
                  ? 'On the way.'
                  : 'Let’s get there.'}
          </Copy>
          {ride.rider && (
            <Card>
              <Copy kind="label">YOUR RIDER</Copy>
              <Copy kind="heading">{ride.rider.name}</Copy>
            </Card>
          )}
          <RouteSummary
            pickup={ride.pickup?.label ?? ride.pickupArea}
            destination={ride.destination?.label ?? ride.destinationArea}
          />
          {destination && action && (
            <Button
              title="Open navigation"
              variant="secondary"
              onPress={() =>
                void Linking.openURL(
                  `https://www.google.com/maps/dir/?api=1&destination=${destination.coordinate.latitude},${destination.coordinate.longitude}&travelmode=driving`,
                ).catch(() => setError('Navigation could not be opened.'))
              }
            />
          )}
          {action &&
            (confirm ? (
              <Card>
                <Copy kind="heading">{action[1]}?</Copy>
                <Copy kind="muted">
                  {ride.state === 'arrived'
                    ? 'Confirm your rider is safely onboard before starting.'
                    : ride.state === 'in_progress'
                      ? 'Confirm you have safely dropped off your rider.'
                      : 'Confirm this trip milestone.'}
                </Copy>
                <Button title={`Confirm: ${action[1]}`} loading={busy} onPress={() => void transition()} />
                <Button
                  title="Not yet"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => setConfirm(false)}
                />
              </Card>
            ) : (
              <Button title={action[1]} onPress={() => setConfirm(true)} />
            ))}
          {!action && <Button title="Back to driving" onPress={() => router.replace('/drive')} />}
        </>
      ) : (
        <Copy kind="muted">Loading your trip…</Copy>
      )}
    </Screen>
  );
}
