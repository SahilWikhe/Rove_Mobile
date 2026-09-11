import { ScrollView, StyleSheet, View } from 'react-native';
import type { DriverEarnings } from '@rove/contracts';
import { Copy, theme } from '@rove/mobile-ui';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'narrow', timeZone: 'UTC' });

/** Figma 3:168. Values are full-period ledger totals, never a sum of the current history page. */
export function DailyEarnings({ days }: { days: NonNullable<DriverEarnings['dailyTotals']> }) {
  if (days.length === 0) return null;
  const maximum = Math.max(1, ...days.map((day) => day.amount));
  const latest = days.at(-1)!;
  const monthly = days.length > 7;
  return (
    <View style={styles.chart} testID="daily-earnings">
      <Copy style={styles.latest}>
        {latest.date} · {money.format(latest.amount / 100)}
      </Copy>
      <ScrollView horizontal showsHorizontalScrollIndicator={monthly} contentContainerStyle={styles.days}>
        {days.map((day, index) => (
          <View
            key={day.date}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${day.date}, ${money.format(day.amount / 100)} recorded earnings`}
            style={[styles.day, monthly && { minWidth: 44 }]}
          >
            <View style={styles.plot}>
              <View
                style={[
                  styles.bar,
                  { height: (day.amount / maximum) * 86 },
                  index === days.length - 1 && { backgroundColor: theme.gold },
                ]}
              />
            </View>
            <Copy style={[styles.label, index === days.length - 1 && { color: theme.text }]}>
              {monthly ? Number(day.date.slice(-2)) : weekday.format(new Date(`${day.date}T00:00:00Z`))}
            </Copy>
          </View>
        ))}
      </ScrollView>
      {monthly && <Copy style={styles.hint}>Daily totals · swipe to see more dates</Copy>}
    </View>
  );
}
const styles = StyleSheet.create({
  chart: { alignSelf: 'stretch', marginTop: 12, gap: 4 },
  latest: { textAlign: 'right', fontSize: 12, fontFamily: 'Manrope_700Bold' },
  days: { flexGrow: 1 },
  day: { flex: 1, alignItems: 'stretch' },
  plot: {
    height: 96,
    justifyContent: 'flex-end',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  bar: {
    width: '70%',
    maxWidth: 30,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    backgroundColor: 'rgba(214,178,109,0.4)',
  },
  label: {
    textAlign: 'center',
    marginTop: 6,
    fontSize: 11,
    fontFamily: 'Manrope_600SemiBold',
    color: theme.muted,
  },
  hint: { fontSize: 11, color: theme.muted, marginTop: 4 },
});
