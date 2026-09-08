import { ApiError } from '@rove/mobile-core';
import { useOperations } from '@rove/mobile-core/use-operations';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { useCallback, useState } from 'react';
import { router, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { RideDetails } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, Money, RouteSummary, Screen } from '@rove/mobile-ui';
const titles: Record<RideDetails['state'], string> = {
  searching: 'Finding your ride.',
  matched: 'Your driver is confirmed.',
  en_route: 'On the way to you.',
  arrived: 'Your driver has arrived.',
  in_progress: 'You’re on your way.',
  completed: 'You’ve arrived.',
  cancelled: 'Ride cancelled.',
  no_driver_found: 'No drivers available right now.',
  no_show: 'Pickup was not completed.',
  interrupted: 'Your trip needs attention.',
  terminated: 'Your trip has ended.',
};
export default function Ride() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, synthetic } = useSession();
  const { pending, restoring, recoveryError, execute } = useOperations();
  const [ride, setRide] = useState<RideDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
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
  async function cancel() {
    if (!ride || restoring || recoveryError) return;
    setBusy(true);
    setError(null);
    try {
      await execute({ kind: 'transition', rideId: ride.id, state: 'cancelled', version: ride.version });
      setRide(await api.ride(id));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'STALE_RIDE') {
        setConfirmCancel(false);
        try {
          setRide(await api.ride(id));
          setError('Your trip changed. Review the latest details and confirm cancellation again.');
        } catch {
          setError(
            'Your trip changed and could not be refreshed. Wait for current details before trying again.',
          );
        }
      } else setError(failure instanceof Error ? failure.message : 'Cancellation could not be confirmed.');
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const result = await execute(pending.operation);
      if (pending.operation.kind === 'book') router.replace({ pathname: '/ride', params: { id: result.id } });
      else setRide(await api.ride(id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Request could not be confirmed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Your ride' }} />
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

      {ride ? (
        <>
          <Copy kind="title">
            {ride.state === 'searching' && !synthetic && ride.paymentState !== 'authorized'
              ? 'Confirm your payment.'
              : titles[ride.state]}
          </Copy>
          <RouteSummary
            pickup={ride.pickup?.label ?? ride.pickupArea}
            destination={ride.destination?.label ?? ride.destinationArea}
          />
          {ride.driver && (
            <Card>
              <Copy kind="label">YOUR DRIVER</Copy>
              <Copy kind="heading">{ride.driver.name}</Copy>
            </Card>
          )}
          <Card>
            <Money cents={ride.fare.amount} label="FARE" />
            <Copy kind="muted">Payment: {ride.paymentState.replaceAll('_', ' ')}</Copy>
          </Card>
          {(ride.state === 'completed' || ['paid', 'review_required'].includes(ride.paymentState)) && (
            <Button
              title="View receipt"
              variant="secondary"
              onPress={() => router.push({ pathname: '/receipt', params: { id: ride.id } })}
            />
          )}
          {!synthetic &&
            ride.state === 'searching' &&
            ['pending', 'action_required'].includes(ride.paymentState) && (
              <Button
                title="Confirm payment"
                onPress={() => router.push({ pathname: '/payment', params: { id: ride.id } })}
              />
            )}
          {!pending &&
            !restoring &&
            !recoveryError &&
            ['searching', 'matched', 'en_route', 'arrived'].includes(ride.state) &&
            (confirmCancel ? (
              <Card>
                <Copy kind="heading">Cancel this ride?</Copy>
                <Copy kind="muted">Your driver search or assignment will end.</Copy>
                <Button
                  title="Confirm cancellation"
                  variant="danger"
                  loading={busy}
                  onPress={() => void cancel()}
                />
                <Button
                  title="Keep ride"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => setConfirmCancel(false)}
                />
              </Card>
            ) : (
              <Button title="Cancel ride" variant="secondary" onPress={() => setConfirmCancel(true)} />
            ))}
        </>
      ) : (
        <Copy kind="muted">Loading your ride…</Copy>
      )}
    </Screen>
  );
}
