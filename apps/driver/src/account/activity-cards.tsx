import type { DriverActivity } from '@rove/contracts';
import { Card, Copy, theme } from '@rove/mobile-ui';
import { View, StyleSheet } from 'react-native';

export function ActivityCards({ activity }: { activity: DriverActivity }) {
  const values = [
    ['TRIPS COMPLETED', activity.completedTrips.toLocaleString()],
    ['OFFERS ACCEPTED', activity.acceptedOffers.toLocaleString()],
    [
      'JOINED ROVE',
      new Date(activity.joinedAt).toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    ],
  ];
  return (
    <View style={styles.row}>
      {values.map(([label, value]) => (
        <Card key={label} style={styles.card}>
          <Copy style={styles.value}>{value}</Copy>
          <Copy style={styles.label}>{label}</Copy>
        </Card>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { flexGrow: 1, flexBasis: 100, padding: 14, borderRadius: 16, gap: 4 },
  value: { fontFamily: 'Manrope_800ExtraBold', fontSize: 18, lineHeight: 26 },
  label: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 0.4,
    color: theme.muted,
  },
});
