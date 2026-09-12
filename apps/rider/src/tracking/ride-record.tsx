import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { RideDetails } from '@rove/contracts';
import { Card, Copy, theme } from '@rove/mobile-ui';
import back from '../../assets/ride-details/back.png';
import route from '../../assets/ride-details/route.png';

// Rider Figma 8:20; only recorded ride data is displayed.
export function RideRecordHeader({ ride, onBack }: { ride: RideDetails; onBack: () => void }) {
  const requested = new Date(ride.createdAt);
  return (
    <>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to my rides"
          onPress={onBack}
          style={styles.backTarget}
        >
          <View style={styles.backCircle}>
            <Image source={back} style={styles.backIcon} accessible={false} />
          </View>
        </Pressable>
        <Copy style={styles.headerTitle}>Ride details</Copy>
        <View style={styles.spacer} />
      </View>
      <View style={styles.summary}>
        <View style={styles.date}>
          <Copy style={styles.time}>
            {requested.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </Copy>
          <Copy style={styles.caption}>
            Requested ·{' '}
            {requested.toLocaleDateString([], {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </Copy>
        </View>
        <View style={styles.status}>
          <Copy style={styles.statusText}>{ride.state.replaceAll('_', ' ')}</Copy>
        </View>
      </View>
    </>
  );
}
export function RideRecordRoute({ ride }: { ride: RideDetails }) {
  return (
    <Card style={styles.card}>
      <View style={styles.routeRow}>
        <Image source={route} style={styles.connector} accessible={false} />
        <View style={styles.addresses}>
          <View>
            <Copy style={styles.address}>{ride.pickup?.label ?? ride.pickupArea}</Copy>
            <Copy style={styles.caption}>Pickup · {ride.pickupArea}</Copy>
          </View>
          <View>
            <Copy style={styles.address}>{ride.destination?.label ?? ride.destinationArea}</Copy>
            <Copy style={styles.caption}>Destination · {ride.destinationArea}</Copy>
          </View>
        </View>
      </View>
    </Card>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backTarget: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  backCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { width: 17, height: 17 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15, lineHeight: 23, flexShrink: 1 },
  spacer: { width: 48 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  date: { flex: 1, minWidth: 170, gap: 3 },
  time: { fontFamily: 'Manrope_800ExtraBold', fontSize: 24, lineHeight: 34 },
  caption: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 19, color: theme.muted },
  status: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statusText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 11,
    lineHeight: 17,
    color: theme.muted,
    textTransform: 'capitalize',
  },
  card: { padding: 18, borderRadius: 18 },
  routeRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  connector: { width: 9, height: 69, marginTop: 5 },
  addresses: { flex: 1, minWidth: 0, gap: 20 },
  address: { fontFamily: 'Manrope_700Bold', fontSize: 14, lineHeight: 22 },
});
