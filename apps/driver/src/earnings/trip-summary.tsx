import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import type { DriverTripEarnings } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { Banner, Button, Card, Copy, Money } from '@rove/mobile-ui';

export function TripEarningsSummary({ rideId }: { rideId: string }) {
  const { api, synthetic } = useSession();
  const [data, setData] = useState<DriverTripEarnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(
      () =>
        pollWhileForeground({
          load: (signal) => api.tripEarnings(rideId, signal),
          onData: (value) => {
            setData(value);
            setError(null);
          },
          onError: () => {
            setData(null);
            setError('Trip earnings could not be loaded. Please check your earnings history.');
          },
          intervalMs: 10000,
        }),
      [api, rideId],
    ),
  );
  return (
    <>
      {synthetic && <Banner message="Synthetic earnings · no money will be paid out." />}
      {error && <Banner error message={error} />}
      {data ? (
        <Card>
          <Money
            cents={(data.recordedAmount ?? data.estimatedAmount).amount}
            label={data.recordedAmount ? 'RECORDED TRIP EARNINGS' : 'ESTIMATED TRIP EARNINGS'}
          />
          <Copy kind="muted">
            {data.recordedAt
              ? `Recorded ${new Date(data.recordedAt).toLocaleString()}`
              : 'Payment is still being processed. This estimate is not yet recorded earnings.'}
          </Copy>
          {data.recordedAmount && data.recordedAmount.amount !== data.estimatedAmount.amount && (
            <Copy kind="muted">
              The recorded amount differs from the original estimate. Contact support if you need help.
            </Copy>
          )}
          <Copy kind="muted">Payouts are not connected yet. This is not an available bank withdrawal.</Copy>
        </Card>
      ) : (
        !error && <Copy kind="muted">Loading trip earnings…</Copy>
      )}
      <Button title="View earnings" variant="secondary" onPress={() => router.push('/earnings')} />
    </>
  );
}
