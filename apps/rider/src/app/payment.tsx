import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Stack, router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { RideDetails } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { latestPaymentRide, paymentAvailability } from '@rove/mobile-core/payment-flow';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { Banner, Button, Card, Copy, Money, RouteSummary, Screen } from '@rove/mobile-ui';
import { usePayments } from '../payments/context';
export default function Payment() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useSession();
  return <PaymentScreen key={`${profile?.id ?? 'signed-out'}:${id}`} id={id} />;
}
function PaymentScreen({ id }: { id: string }) {
  const { api, profile } = useSession();
  const payments = usePayments();
  const [ride, setRide] = useState<RideDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const epoch = useRef(0);
  const paying = useRef(false);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      epoch.current++;
      setBusy(paying.current);
      setRide(null);
      setError(null);
      setNotice(null);
      setReadError(null);
      if (!profile?.id)
        return () => {
          active.current = false;
          epoch.current++;
        };
      const dispose = pollWhileForeground({
        load: (signal) => api.ride(id, signal),
        onData: (updated) => {
          if (updated.id !== id) return;
          setReadError(null);
          setRide((old) => latestPaymentRide(old, updated));
        },
        onError: () => setReadError('Ride status could not be refreshed. Check your connection.'),
        intervalMs: 3000,
      });
      return () => {
        active.current = false;
        epoch.current++;
        dispose();
      };
    }, [api, id, profile?.id]),
  );
  const availability = paymentAvailability(ride, id, !!readError);
  const authorized = availability === 'confirmed';
  const canPay = availability === 'ready';
  const requestClosed =
    availability === 'closed' && !!ride && ['cancelled', 'no_driver_found'].includes(ride.state);
  async function pay() {
    if (!canPay || paying.current) return;
    const started = epoch.current;
    const current = () => active.current && epoch.current === started;
    paying.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await payments.pay(id, current);
      if (!current()) return;
      setNotice(
        result === 'cancelled'
          ? 'Payment entry was closed. Your ride request is still awaiting payment.'
          : result === 'submitted'
            ? 'Checking your payment with Rove. Your ride status will update when confirmed.'
            : null,
      );
      try {
        const updated = await api.ride(id);
        if (current()) {
          setRide((old) => latestPaymentRide(old, updated));
          setReadError(null);
        }
      } catch {
        if (current()) setReadError('Ride status could not be refreshed. Check your connection.');
      }
    } catch {
      if (current()) setError('Payment could not be confirmed. Check your ride status before trying again.');
    } finally {
      paying.current = false;
      if (active.current) setBusy(false);
    }
  }
  if (!profile)
    return (
      <Screen>
        <Copy kind="heading">Sign in to confirm your payment.</Copy>
        <Button title="Back to sign in" onPress={() => router.replace('/')} />
      </Screen>
    );
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Confirm payment' }} />
      <Copy kind="title">One step closer.</Copy>
      <Copy kind="muted">Confirm your payment before we match you with a driver.</Copy>
      {(error || readError) && <Banner error message={error ?? readError!} />}
      {notice && (canPay || availability === 'unknown') && <Banner message={notice} />}
      {ride ? (
        <>
          <RouteSummary
            pickup={ride.pickup?.label ?? ride.pickupArea}
            destination={ride.destination?.label ?? ride.destinationArea}
          />
          <Card>
            <Money cents={ride.fare.amount} label="YOUR FARE" />
            <Copy kind="muted">
              We’ll authorize this amount now and collect payment after your ride. Your bank may show a
              temporary hold.
            </Copy>
          </Card>
          {availability === 'unknown' ? (
            <Banner message="Waiting for current ride status before confirming payment." />
          ) : authorized ? (
            <Banner message="Payment confirmed. Continue to your ride." />
          ) : requestClosed ? (
            <Card>
              <Copy kind="heading">This ride request has ended.</Copy>
              <Copy>Review your route and get a new fare before requesting another ride.</Copy>
              <Copy kind="muted">
                Any payment hold is handled separately. Open your ride to check its payment status.
              </Copy>
              <Button
                title="Review route for a new ride"
                disabled={busy}
                onPress={() => router.replace({ pathname: '/book', params: { fromRide: id } })}
              />
            </Card>
          ) : !canPay ? (
            <Banner message="This ride is not waiting for payment. Open your ride for the latest status." />
          ) : payments.available ? (
            <Button title="Choose payment method" loading={busy} onPress={() => void pay()} />
          ) : (
            <Banner
              message={
                Platform.OS === 'web'
                  ? 'Open Rove on iOS or Android to confirm payment.'
                  : 'Payments are not available in this build yet.'
              }
            />
          )}
          <Button
            title={authorized ? 'Continue to ride' : 'Return to ride'}
            variant="secondary"
            disabled={busy}
            onPress={() => router.replace({ pathname: '/ride', params: { id } })}
          />
        </>
      ) : (
        <Copy kind="muted">Loading your fare…</Copy>
      )}
    </Screen>
  );
}
