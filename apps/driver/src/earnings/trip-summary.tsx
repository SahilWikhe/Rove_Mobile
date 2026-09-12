import { AdjustmentBreakdown } from './adjustment-breakdown';
import { View } from 'react-native';
import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import type { DriverTripEarnings } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { Banner, Button, Card, Copy, theme } from '@rove/mobile-ui';

export function TripEarningsSummary({ rideId }: { rideId: string }) {
  const { api } = useSession();
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
      {error && <Banner error message={error} />}
      {data ? (
        <Card style={{ padding: 18, borderRadius: 18, gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <Copy kind="muted" style={{ fontSize: 13 }}>
              Original earnings estimate
            </Copy>
            <Copy style={{ fontSize: 13 }}>
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                data.estimatedAmount.amount / 100,
              )}
            </Copy>
          </View>
          <View style={{ height: 1, backgroundColor: theme.border }} />
          <Copy kind="label">
            {data.recordedAmount ? 'RECORDED TRIP EARNINGS' : 'ESTIMATED TRIP EARNINGS'}
          </Copy>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <Copy style={{ fontSize: 15, fontFamily: 'Manrope_800ExtraBold' }}>
              {data.netRecordedAmount
                ? 'Net earnings'
                : data.recordedAmount
                  ? 'You earned'
                  : 'Estimated earnings'}
            </Copy>
            <Copy style={{ color: theme.gold, fontSize: 22, fontFamily: 'Manrope_800ExtraBold' }}>
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                (data.netRecordedAmount ?? data.recordedAmount ?? data.estimatedAmount).amount / 100,
              )}
            </Copy>
          </View>
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
          {data.recordedAmount && data.adjustmentAmount && (
            <AdjustmentBreakdown
              gross={data.recordedAmount.amount}
              adjustment={data.adjustmentAmount.amount}
              refund={data.refundAdjustmentAmount?.amount}
              dispute={data.disputeAdjustmentAmount?.amount}
            />
          )}
          {data.recordedAmount && !data.adjustmentAmount && (
            <Copy kind="muted">
              Gross trip earnings. Adjustment details are not available from this server.
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
