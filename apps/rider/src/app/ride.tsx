import { CompletedRide } from '../tracking/completed-ride';
import { FindingRide } from '../tracking/finding-ride';
import { View } from 'react-native';
import { RideRecordHeader, RideRecordRoute } from '../tracking/ride-record';
import { OpenConversation } from '../messaging/open-conversation';
import { TrackingHeader, trackingCaptions } from '../tracking/tracking-header';
import { DriverSummary } from '../tracking/driver-summary';
import { RiderTripMap } from '../tracking/trip-map';
import { ApiError } from '@rove/mobile-core';
import { useOperations } from '@rove/mobile-core/use-operations';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { useCallback, useState } from 'react';
import { router, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { RideSummary, type RideDetails } from '@rove/contracts';
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
  const session = useSession();
  if (!session.ready)
    return (
      <Screen>
        <Copy kind="muted">Restoring your account…</Copy>
      </Screen>
    );
  if (!session.profile)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Your ride' }} />
        <Copy kind="heading">Sign in to view your ride</Copy>
        <Copy kind="muted">
          Open your account to sign in or finish setup, then find this trip in My rides.
        </Copy>
        <Button title="Continue to your account" onPress={() => router.replace('/')} />
      </Screen>
    );
  const parsed = RideSummary.shape.id.safeParse(id);
  if (!parsed.success)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Your ride' }} />
        <Copy kind="heading">This ride link is incomplete</Copy>
        <Copy kind="muted">Choose a trip from your ride history to see its latest details.</Copy>
        <Button title="Open My rides" onPress={() => router.replace('/rides')} />
      </Screen>
    );
  return <RideContent key={`${session.profile.id}:${parsed.data}`} id={parsed.data} />;
}

/** Never retain a previous account's trip or pending UI after an account/route change. */
function RideContent({ id }: { id: string }) {
  const { api, synthetic } = useSession();
  const { pending, restoring, recoveryError, execute } = useOperations();
  const [loadedRide, setRide] = useState<RideDetails | null>(null);
  const ride = loadedRide?.id === id ? loadedRide : null;
  const trackingCaption = ride ? trackingCaptions[ride.state] : undefined;
  const ended =
    !!ride && ['completed', 'cancelled', 'no_driver_found', 'no_show', 'terminated'].includes(ride.state);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const finding = ride?.state === 'searching' && (synthetic || ride.paymentState === 'authorized');
  useFocusEffect(
    useCallback(() => {
      setRide(null);
      setShowDetails(false);
      setReadError(null);
      setError(null);
      setConfirmCancel(false);
      return pollWhileForeground({
        load: (signal) => api.ride(id, signal),
        onData: (updated) => {
          if (updated.id !== id) return;
          setRide((current) =>
            current?.id === updated.id && current.version > updated.version ? current : updated,
          );
          setReadError(null);
        },
        onError: (failure) => {
          setConfirmCancel(false);
          setReadError(failure instanceof Error ? failure.message : 'Trip information is unavailable.');
        },
        intervalMs: 4000,
      });
    }, [api, id]),
  );
  async function cancel() {
    if (!ride || readError || busy || restoring || recoveryError) return;
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
          setReadError(
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
  const cancellation =
    ride &&
    !pending &&
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
          disabled={!!readError}
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
      <Button
        title="Cancel ride"
        variant="secondary"
        style={
          finding
            ? { minHeight: 48, backgroundColor: 'transparent', borderWidth: 0, paddingHorizontal: 12 }
            : undefined
        }
        textStyle={finding ? { fontSize: 13 } : undefined}
        disabled={!!readError || busy}
        onPress={() => setConfirmCancel(true)}
      />
    ));
  return (
    <Screen
      contentStyle={
        finding
          ? { flexGrow: 1, padding: 20, gap: 16 }
          : trackingCaption || ended
            ? { padding: 20, gap: 16 }
            : undefined
      }
    >
      <Stack.Screen options={{ title: 'Your ride', headerShown: !trackingCaption && !ended && !finding }} />
      {trackingCaption && (
        <TrackingHeader
          caption={trackingCaption}
          onBack={() => router.replace('/rides')}
          onAccount={() => router.push('/account')}
        />
      )}
      {ended && ride && <RideRecordHeader ride={ride} onBack={() => router.replace('/rides')} />}
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
          {finding && (
            <View style={{ alignSelf: confirmCancel ? 'stretch' : 'flex-end' }}>{cancellation}</View>
          )}
          {finding && <FindingRide reconnecting={!!readError} />}
          {finding && (
            <Button
              title={showDetails ? 'Hide ride details' : 'Show ride details'}
              variant="secondary"
              onPress={() => setShowDetails(!showDetails)}
            />
          )}
          {(!finding || showDetails) && (
            <>
              {ride.state === 'completed' && <CompletedRide ride={ride} />}
              {!finding && ride.state !== 'completed' && (
                <Copy
                  kind="title"
                  style={
                    trackingCaption || ended
                      ? { fontSize: 23, lineHeight: 29, letterSpacing: -0.5 }
                      : undefined
                  }
                >
                  {ride.state === 'searching' && !synthetic && ride.paymentState !== 'authorized'
                    ? 'Confirm your payment.'
                    : titles[ride.state]}
                </Copy>
              )}
              {!finding && ride.state !== 'completed' && <RiderTripMap key={ride.id} ride={ride} />}
              <DriverSummary ride={ride} contact={<OpenConversation key={ride.id} rideId={ride.id} />} />
              {ended ? (
                <RideRecordRoute ride={ride} />
              ) : (
                <RouteSummary
                  pickup={ride.pickup?.label ?? ride.pickupArea}
                  destination={ride.destination?.label ?? ride.destinationArea}
                />
              )}
              <Card>
                <Money cents={ride.fare.amount} label="FARE" />
                <Copy kind="muted">Payment: {ride.paymentState.replaceAll('_', ' ')}</Copy>
              </Card>
            </>
          )}
          {(ride.state === 'completed' || ['paid', 'review_required'].includes(ride.paymentState)) && (
            <Button
              title="View receipt"
              variant="secondary"
              onPress={() => router.push({ pathname: '/receipt', params: { id: ride.id } })}
            />
          )}
          {ended && (
            <Button
              title="Get help with this ride"
              variant="secondary"
              onPress={() =>
                router.push({ pathname: '/support', params: { rideId: ride.id, category: 'trip' } })
              }
            />
          )}
          {['completed', 'cancelled'].includes(ride.state) && ride.pickup && ride.destination && (
            <Button
              title="Book this trip again"
              disabled={!!readError || !!pending || restoring || !!recoveryError}
              onPress={() => router.push({ pathname: '/book', params: { fromRide: ride.id } })}
            />
          )}
          {ride.state === 'no_driver_found' && (
            <Card>
              <Copy>
                No driver was matched to this request. You can review the route and try a new search.
              </Copy>
              <Copy kind="muted">
                Any payment hold is handled separately. Your bank may take time to show a released hold.
              </Copy>
              <Button
                title="Try a new search"
                disabled={!!pending || restoring || !!recoveryError}
                onPress={() => router.push({ pathname: '/book', params: { fromRide: ride.id } })}
              />
              <Button
                title="Change route"
                variant="secondary"
                disabled={!!pending || restoring || !!recoveryError}
                onPress={() => router.push('/book')}
              />
              <Button title="Back home" variant="secondary" onPress={() => router.replace('/')} />
            </Card>
          )}
          {!synthetic &&
            ride.state === 'searching' &&
            ['pending', 'action_required'].includes(ride.paymentState) && (
              <Button
                title="Confirm payment"
                onPress={() => router.push({ pathname: '/payment', params: { id: ride.id } })}
              />
            )}
          {!finding && cancellation}
        </>
      ) : (
        <>
          <Copy kind="muted">
            {readError
              ? 'Your ride details could not be loaded. We’ll retry while this screen is open.'
              : 'Loading your ride…'}
          </Copy>
          <Button title="Open My rides" variant="secondary" onPress={() => router.replace('/rides')} />
        </>
      )}
    </Screen>
  );
}
