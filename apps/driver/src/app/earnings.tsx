import { Keyboard } from 'react-native';
import { DriverNavigation } from '../navigation/driver-navigation';
import { useCallback, useState } from 'react';
import { Stack, router, useFocusEffect } from 'expo-router';
import { EarningsDateRange, type DriverEarnings } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { Banner, Button, Card, Copy, Field, Money, Screen } from '@rove/mobile-ui';
export default function Earnings() {
  const { profile } = useSession();
  return <EarningsBrowser key={profile?.id ?? 'signed-out'} />;
}
function EarningsBrowser() {
  const [cursors, setCursors] = useState<string[]>([]);
  const before = cursors.at(-1);
  const [range, setRange] = useState<EarningsDateRange | undefined>();
  return (
    <EarningsContent
      key={`${range?.from ?? ''}:${range?.through ?? ''}:${before ?? 'latest'}`}
      before={before}
      range={range}
      applyRange={(value) => {
        setCursors([]);
        setRange(value);
      }}
      older={(cursor) => setCursors((previous) => [...previous, cursor])}
      newer={before ? () => setCursors((previous) => previous.slice(0, -1)) : undefined}
    />
  );
}
function EarningsContent({
  before,
  range,
  applyRange,
  older,
  newer,
}: {
  before: string | undefined;
  range: EarningsDateRange | undefined;
  applyRange: (range: EarningsDateRange | undefined) => void;
  older: (cursor: string) => void;
  newer: (() => void) | undefined;
}) {
  const { api, profile, synthetic } = useSession();
  const [from, setFrom] = useState(range?.from ?? '');
  const [through, setThrough] = useState(range?.through ?? '');
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [data, setData] = useState<DriverEarnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!profile) return;
      return pollWhileForeground({
        load: (signal) => api.earnings(signal, before, range),
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
    }, [api, profile, before, range]),
  );
  return (
    <Screen footer={profile ? <DriverNavigation active="/earnings" /> : undefined}>
      <Stack.Screen options={{ title: 'Earnings' }} />
      <Copy kind="title">Your work. Recorded.</Copy>
      {synthetic && <Banner message="Synthetic earnings · no money will be paid out." />}
      {profile && (
        <Card>
          <Copy kind="heading">Filter recorded dates</Copy>
          <Copy kind="muted">Use YYYY-MM-DD. Dates include the full day in UTC.</Copy>
          <Field
            label="From date (UTC)"
            testID="earnings-from-date"
            autoCorrect={false}
            maxLength={10}
            value={from}
            onChangeText={setFrom}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
          />
          <Field
            label="Through date (UTC)"
            testID="earnings-through-date"
            autoCorrect={false}
            maxLength={10}
            value={through}
            onChangeText={setThrough}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
          />
          {rangeError && <Banner error message={rangeError} />}
          <Button
            title="Apply dates"
            variant="secondary"
            onPress={() => {
              Keyboard.dismiss();
              const parsed = EarningsDateRange.safeParse({ from, through });
              if (!parsed.success) {
                setRangeError('Enter valid dates with the start on or before the end.');
                return;
              }
              setRangeError(null);
              applyRange(parsed.data);
            }}
          />
          {range && (
            <Button title="All recorded dates" variant="secondary" onPress={() => applyRange(undefined)} />
          )}
        </Card>
      )}
      {newer && <Button title="Newer earnings" variant="secondary" onPress={newer} />}
      {error && <Banner error message={error} />}
      {data ? (
        <>
          <Card>
            <Money cents={data.recordedTotal.amount} label="LIFETIME RECORDED EARNINGS" />
            <Copy kind="muted">
              Allocated from captured trip payments. Before payouts or later adjustments.
            </Copy>
          </Card>
          {range && data.periodTotal && (
            <Card>
              <Money cents={data.periodTotal.amount} label="RECORDED IN SELECTED PERIOD" />
              <Copy kind="muted">
                {range.from} through {range.through} (UTC)
              </Copy>
            </Card>
          )}
          <Banner message="Recorded earnings are not an available withdrawal balance. Review payout setup separately." />
          <Button title="Review payout setup" variant="secondary" onPress={() => router.push('/payouts')} />
          <Copy kind="heading">{before ? 'Earlier earnings' : 'Recent earnings'}</Copy>
          {data.entries.length === 0 && (
            <Copy kind="muted">
              {range
                ? 'No recorded earnings in this date range.'
                : 'Your earnings appear once a completed trip’s payment is captured and allocated.'}
            </Copy>
          )}
          {data.entries.map((entry) => (
            <Card key={entry.id}>
              <Money cents={entry.amount.amount} label="TRIP EARNINGS" />
              <Copy kind="muted">Recorded {new Date(entry.recordedAt).toLocaleString()}</Copy>
              <Copy kind="muted">Trip reference {entry.rideId}</Copy>
              <Button
                title="View trip details"
                variant="secondary"
                onPress={() => router.push({ pathname: '/trip', params: { id: entry.rideId } })}
              />
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
