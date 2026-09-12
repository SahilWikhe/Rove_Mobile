import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { Copy, theme } from '@rove/mobile-ui';

/** Figma dashboard metric cards, backed by recorded earnings rather than mock figures. */
export function DriveEarnings() {
  const { api, profile } = useSession();
  const [totals, setTotals] = useState<{
    today: number | undefined;
    allTime: number;
    adjusted: boolean;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!profile) return;
      return pollWhileForeground({
        load: (signal) => {
          const day = new Date().toISOString().slice(0, 10);
          return api.earnings(signal, undefined, { from: day, through: day });
        },
        onData: (data) => {
          setTotals({
            today: (data.periodNetTotal ?? data.periodTotal)?.amount,
            allTime: (data.netTotal ?? data.recordedTotal).amount,
            adjusted: !!data.netTotal,
          });
          setFailed(false);
        },
        onError: () => {
          setTotals(null);
          setFailed(true);
        },
        intervalMs: 15000,
      });
    }, [api, profile]),
  );
  const money = (amount: number | undefined) =>
    amount === undefined
      ? '—'
      : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100);
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.row}>
        <View style={styles.card}>
          <Copy style={styles.amount}>{money(totals?.today)}</Copy>
          <Copy style={styles.label}>TODAY · UTC</Copy>
        </View>
        <View style={styles.card}>
          <Copy style={styles.amount}>{money(totals?.allTime)}</Copy>
          <Copy style={styles.label}>ALL TIME</Copy>
        </View>
      </View>
      <Copy kind="muted" style={styles.note}>
        {failed
          ? 'Earnings are unavailable right now.'
          : totals?.adjusted
            ? 'Net earnings · adjustments and payout details in Earnings'
            : 'Gross trip earnings · adjustment details unavailable'}
      </Copy>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  card: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
    borderRadius: 16,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  amount: { fontFamily: 'Manrope_800ExtraBold', fontSize: 20, lineHeight: 28 },
  label: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.44,
    color: theme.muted,
  },
  note: { fontSize: 11, lineHeight: 16 },
});
