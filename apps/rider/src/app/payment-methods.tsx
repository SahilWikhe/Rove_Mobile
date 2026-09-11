import { useCallback, useRef, useState } from 'react';
import { Stack, useFocusEffect } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, Screen } from '@rove/mobile-ui';
import { usePayments } from '../payments/context';

export default function PaymentMethods() {
  const { profile } = useSession();
  return <PaymentSettings key={profile?.id ?? 'signed-out'} signedIn={Boolean(profile)} />;
}
function PaymentSettings({ signedIn }: { signedIn: boolean }) {
  const payments = usePayments();
  const focused = useRef(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      generation.current++;
      setBusy(pending.current);
      return () => {
        focused.current = false;
        generation.current++;
      };
    }, []),
  );
  async function open() {
    if (pending.current || !payments.available || !signedIn) return;
    const started = generation.current;
    const current = () => focused.current && generation.current === started;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await payments.manage(current);
    } catch {
      if (current()) setError('Payment settings could not be loaded. Please try again.');
    } finally {
      pending.current = false;
      if (focused.current) setBusy(false);
    }
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Payment methods' }} />
      <Copy kind="title">Ready for your next ride.</Copy>
      {!signedIn ? (
        <Copy>Sign in to manage your payment methods.</Copy>
      ) : (
        <Card>
          <Copy kind="heading">Your saved payment methods</Copy>
          <Copy kind="muted">
            Add or remove payment methods securely with Stripe. Saving a method lets you choose it for future
            rides; it does not book a ride or make a payment.
          </Copy>
          {!payments.available && (
            <Copy kind="muted">
              Payment settings are not available in this build. Use a configured iOS or Android app to manage
              saved methods.
            </Copy>
          )}
          {error && <Banner error message={error} />}
          <Button
            title="Manage saved payment methods"
            disabled={!payments.available}
            loading={busy}
            onPress={() => void open()}
          />
        </Card>
      )}
    </Screen>
  );
}
