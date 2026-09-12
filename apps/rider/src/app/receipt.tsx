import { useCallback, useState } from 'react';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { RideReceipt } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { Banner, Button, Card, Copy, Money, Screen } from '@rove/mobile-ui';
export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useSession();
  const [retry, setRetry] = useState(0);
  return (
    <ReceiptContent
      key={`${profile?.id ?? 'signed-out'}:${id}:${retry}`}
      id={id}
      retry={() => setRetry((value) => value + 1)}
    />
  );
}
function ReceiptContent({ id, retry }: { id: string; retry: () => void }) {
  const { api, profile } = useSession();
  const [receipt, setReceipt] = useState<RideReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!profile?.id) return;
      return pollWhileForeground({
        load: (signal) => api.receipt(id, signal),
        onData: (value) => {
          setReceipt(value);
          setError(null);
        },
        onError: (failure) => {
          setReceipt(null);
          setError(failure instanceof Error ? failure.message : 'Your receipt could not be loaded.');
        },
        intervalMs: 10000,
      });
    }, [api, id, profile?.id]),
  );
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Your receipt' }} />
      <Copy kind="title">Your payment record.</Copy>
      {error && (
        <>
          <Banner error message={error} />
          <Button title="Retry receipt" variant="secondary" onPress={retry} />
        </>
      )}
      {receipt ? (
        <>
          <Card>
            <Money cents={receipt.capturedAmount.amount} label="AMOUNT CAPTURED" />
            <Copy kind="muted">Recorded {new Date(receipt.recordedAt).toLocaleString()}</Copy>
          </Card>
          <Card>
            <Money cents={receipt.quotedFare.amount} label="QUOTED FARE" />
            <Copy>Ride: {receipt.rideState.replaceAll('_', ' ')}</Copy>
            <Copy>Payment: {receipt.paymentState.replaceAll('_', ' ')}</Copy>
          </Card>
          {receipt.capturedAmount.amount !== receipt.quotedFare.amount && (
            <Banner message="The recorded capture differs from your quoted fare. Your payment is being reviewed." />
          )}
          <Copy kind="muted">Receipt reference</Copy>
          <Copy>{receipt.id}</Copy>
        </>
      ) : (
        !error && (
          <Copy kind="muted">{profile ? 'Loading your receipt…' : 'Sign in to view your receipt.'}</Copy>
        )
      )}
      <Button
        title="Back to ride"
        variant="secondary"
        onPress={() => router.replace({ pathname: '/ride', params: { id } })}
      />
    </Screen>
  );
}
