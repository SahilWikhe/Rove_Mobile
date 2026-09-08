import { TripMap } from '@rove/mobile-ui/trip-map';
import { TripEarningsSummary } from '../earnings/trip-summary';
import { useOperations } from '@rove/mobile-core/use-operations';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { useTrackingError } from '../tracking/provider';
import { useCallback, useState } from 'react';
import { NavigationButton } from '../navigation/button';
import { router, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
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
  const { api, synthetic, profile } = useSession();
  const { pending, restoring, recoveryError, execute } = useOperations();
  const trackingError = useTrackingError();
  const [ride, setRide] = useState<RideDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useFocusEffect(
    useCallback(
      () =>
        pollWhileForeground({
          load: (signal) => api.ride(id, signal),
          onData: (updated) => {
            setRide((current) =>
              current?.id === updated.id && current.version > updated.version ? current : updated,
            );
            setReadError(null);
          },
          onError: (failure) =>
            setReadError(failure instanceof Error ? failure.message : 'Trip information is unavailable.'),
          intervalMs: 4000,
        }),
      [api, id],
    ),
  );
  const action = ride && ride.state in actions ? actions[ride.state as keyof typeof actions] : null;
  async function transition() {
    if (!ride || !action || restoring || recoveryError) return;
    setBusy(true);
    setError(null);
    try {
      await execute({ kind: 'transition', rideId: id, state: action[0], version: ride.version });
      setRide(await api.ride(id));
      setConfirm(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Trip update was not confirmed.');
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await execute(pending.operation);
      setRide(await api.ride(id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Request could not be confirmed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Active trip' }} />
      {(error || readError) && <Banner error message={error ?? readError!} />}
      {recoveryError && <Banner error message={recoveryError} />}
      {pending && (
        <Card>
          <Copy kind="heading">A previous request needs confirmation.</Copy>
          <Copy>
            Check its result before submitting another action. Your original request will be reused.
          </Copy>
          <Button title="Check previous action" loading={busy} onPress={() => void recover()} />
        </Card>
      )}

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
          {ride.pickup && ride.destination && (
            <TripMap
              key={ride.id}
              pickup={ride.pickup.coordinate}
              destination={ride.destination.coordinate}
              synthetic={synthetic}
              androidEnabled={!!process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY}
              iosEnabled={!!process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY}
            />
          )}
          <RouteSummary
            pickup={ride.pickup?.label ?? ride.pickupArea}
            destination={ride.destination?.label ?? ride.destinationArea}
          />
          <NavigationButton
            key={`${profile?.id}:${ride.id}:${ride.version}`}
            ride={ride}
            disabled={busy || !!readError || !!pending || restoring || !!recoveryError}
          />
          {action &&
            !pending &&
            !restoring &&
            !recoveryError &&
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
          {ride.state === 'completed' && <TripEarningsSummary key={ride.id} rideId={ride.id} />}
          {!action && <Button title="Back to driving" onPress={() => router.replace('/drive')} />}
        </>
      ) : (
        <Copy kind="muted">Loading your trip…</Copy>
      )}
    </Screen>
  );
}
