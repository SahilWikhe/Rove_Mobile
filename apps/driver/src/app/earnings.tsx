import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { DriverNavigation } from '../navigation/driver-navigation';
import { useCallback, useState } from 'react';
import { Stack, router, useFocusEffect } from 'expo-router';
import { EarningsDateRange, type DriverEarnings } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { Banner, Button, Card, Copy, Field, Money, Screen, theme } from '@rove/mobile-ui';
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
  const [customDates, setCustomDates] = useState(false);
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
  const today = new Date();
  const date = (value: Date) => value.toISOString().slice(0, 10);
  const weekStart = new Date(today);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const presets = [
    { label: 'Last 7 days', from: date(weekStart), through: date(today) },
    {
      label: 'This month',
      from: date(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))),
      through: date(today),
    },
  ];
  return (
    <Screen
      contentStyle={{ padding: 20, gap: 16 }}
      footer={profile ? <DriverNavigation active="/earnings" /> : undefined}
    >
      <Stack.Screen options={{ title: 'Earnings', headerShown: false }} />
      <Copy kind="title" style={styles.title}>
        Earnings
      </Copy>
      {profile && (
        <View accessibilityRole="tablist" style={styles.filters}>
          {presets.map((preset) => {
            const selected = range?.from === preset.from && range.through === preset.through;
            return (
              <Pressable
                key={preset.label}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                aria-selected={selected}
                onPress={() => applyRange({ from: preset.from, through: preset.through })}
                style={[styles.filter, selected && styles.selectedFilter]}
              >
                <Copy style={[styles.filterText, selected && { color: '#120D02' }]}>{preset.label}</Copy>
              </Pressable>
            );
          })}
        </View>
      )}
      {synthetic && <Banner message="Synthetic earnings · no money will be paid out." />}
      {profile && (
        <Button
          title={customDates ? 'Hide custom dates' : 'Filter recorded dates'}
          variant="secondary"
          onPress={() => setCustomDates(!customDates)}
        />
      )}
      {profile && customDates && (
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
          <Card style={styles.summary}>
            <Copy style={styles.amount}>
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                (range && data.periodTotal ? data.periodTotal.amount : data.recordedTotal.amount) / 100,
              )}
            </Copy>
            <Copy kind="muted" style={styles.caption}>
              {range ? `${range.from} – ${range.through} · UTC` : 'Lifetime recorded earnings'}
            </Copy>
            <Copy kind="muted" style={styles.caption}>
              Allocated from captured trip payments, before payouts or adjustments.
            </Copy>
          </Card>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Review payout setup"
            onPress={() => router.push('/payouts')}
            style={styles.payout}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Copy style={{ fontFamily: 'Manrope_700Bold', fontSize: 14 }}>Payout setup</Copy>
              <Copy kind="muted" style={styles.caption}>
                Review your payout account and eligibility
              </Copy>
            </View>
            <Copy style={{ color: theme.gold }}>›</Copy>
          </Pressable>
          <Copy kind="muted" style={styles.caption}>
            Recorded earnings are not an available withdrawal balance.
          </Copy>
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
              <View testID={`earning-${entry.rideId}`} style={{ gap: 12 }}>
                <Money cents={entry.amount.amount} label="TRIP EARNINGS" />
                <Copy kind="muted">Recorded {new Date(entry.recordedAt).toLocaleString()}</Copy>
                <Button
                  title="View trip details"
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/trip', params: { id: entry.rideId } })}
                />
              </View>
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

const styles = StyleSheet.create({
  title: { fontSize: 26, letterSpacing: -0.52, fontFamily: 'Manrope_800ExtraBold' },
  filters: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  filter: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    padding: 8,
  },
  selectedFilter: { backgroundColor: theme.gold },
  filterText: { fontSize: 13, fontFamily: 'Manrope_700Bold', color: theme.muted },
  summary: { padding: 20, borderRadius: 18, gap: 8 },
  amount: { fontSize: 34, letterSpacing: -0.68, fontFamily: 'Manrope_800ExtraBold', color: theme.gold },
  caption: { fontSize: 13, lineHeight: 20 },
  payout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    padding: 18,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    minHeight: 64,
  },
});
