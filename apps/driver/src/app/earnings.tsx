import { useCallback, useState } from 'react';
import { Stack, useFocusEffect } from 'expo-router';
import type { DriverEarnings } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { Banner, Button, Card, Copy, Money, Screen } from '@rove/mobile-ui';
export default function Earnings() {
  const { profile } = useSession();
  return <EarningsBrowser key={profile?.id ?? 'signed-out'} />;
}
function EarningsBrowser() {
  const [cursors, setCursors] = useState<string[]>([]);
  const before = cursors.at(-1);
  return (
    <EarningsContent
      key={before ?? 'latest'}
      before={before}
      older={(cursor) => setCursors((previous) => [...previous, cursor])}
      newer={before ? () => setCursors((previous) => previous.slice(0, -1)) : undefined}
    />
  );
}
function EarningsContent({
  before,
  older,
  newer,
}: {
  before: string | undefined;
  older: (cursor: string) => void;
  newer: (() => void) | undefined;
}) {
  const { api, profile, synthetic } = useSession();
  const [data, setData] = useState<DriverEarnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!profile) return;
      return pollWhileForeground({
        load: (signal) => api.earnings(signal, before),
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
    }, [api, profile, before]),
  );
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Earnings' }} />
      <Copy kind="title">Your work. Recorded.</Copy>
      {synthetic && <Banner message="Synthetic earnings · no money will be paid out." />}
      {newer && <Button title="Newer earnings" variant="secondary" onPress={newer} />}
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
          <Copy kind="heading">{before ? 'Earlier earnings' : 'Recent earnings'}</Copy>
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
          {data.nextCursor && (
            <Button title="Older earnings" variant="secondary" onPress={() => older(data.nextCursor!)} />
          )}
        </>
      ) : (
        !error && <Copy kind="muted">{profile ? 'Loading earnings…' : 'Sign in to view earnings.'}</Copy>
      )}
    </Screen>
  );
}
