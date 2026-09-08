import { useCallback, useState } from 'react';
import { Stack, useFocusEffect } from 'expo-router';
import type { DriverEarnings } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { Banner, Card, Copy, Money, Screen } from '@rove/mobile-ui';
export default function Earnings() {
  const { profile } = useSession();
  return <EarningsContent key={profile?.id ?? 'signed-out'} />;
}
function EarningsContent() {
  const { api, profile } = useSession();
  const [data, setData] = useState<DriverEarnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!profile) return;
      return pollWhileForeground({
        load: (signal) => api.earnings(signal),
        onData: (value) => {
          setData(value);
          setError(null);
        },
        onError: (failure) => {
          setData(null);
          setError(failure instanceof Error ? failure.message : 'Earnings could not be loaded.');
        },
        intervalMs: 15000,
      });
    }, [api, profile]),
  );
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Earnings' }} />
      <Copy kind="title">Your work. Recorded.</Copy>
      {error && <Banner error message={error} />}
      {data ? (
        <>
          <Card>
            <Money cents={data.recordedTotal.amount} label="RECORDED EARNINGS" />
            <Copy kind="muted">
              Allocated from captured trip payments. Before payouts or later adjustments.
            </Copy>
          </Card>
          <Banner message="Payouts are not connected yet. This amount is not an available bank withdrawal." />
          <Copy kind="heading">Recent earnings</Copy>
          {data.entries.length === 0 && (
            <Copy kind="muted">
              Your earnings appear once a completed trip’s payment is captured and allocated.
            </Copy>
          )}
          {data.entries.map((entry) => (
            <Card key={entry.id}>
              <Money cents={entry.amount.amount} label="TRIP EARNINGS" />
              <Copy kind="muted">Recorded {new Date(entry.recordedAt).toLocaleString()}</Copy>
              <Copy kind="muted">Trip reference {entry.rideId}</Copy>
            </Card>
          ))}
          {data.hasMore && (
            <Copy kind="muted">
              Showing your latest 50 records. The total includes all recorded earnings.
            </Copy>
          )}
        </>
      ) : (
        !error && <Copy kind="muted">{profile ? 'Loading earnings…' : 'Sign in to view earnings.'}</Copy>
      )}
    </Screen>
  );
}
