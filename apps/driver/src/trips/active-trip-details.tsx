import { Image, StyleSheet, View } from 'react-native';
import type { RideDetails } from '@rove/contracts';
import { Copy, theme } from '@rove/mobile-ui';
import riderAvatar from '../../assets/trip/rider.png';

/** Figma 2:167 and 2:245. Only show details authorized after acceptance. */
export function ActiveTripDetails({ ride }: { ride: RideDetails }) {
  const droppingOff = ride.state === 'in_progress';
  return (
    <View style={styles.details}>
      {!droppingOff && (
        <View style={styles.rider}>
          <Image source={riderAvatar} accessible={false} style={styles.avatar} />
          <View style={styles.text}>
            <Copy style={styles.name}>{ride.rider?.name ?? 'Your rider'}</Copy>
            <Copy style={styles.address}>{ride.pickup?.label ?? ride.pickupArea}</Copy>
          </View>
        </View>
      )}
      <View style={styles.text}>
        <Copy style={styles.label}>{droppingOff ? 'DROPPING OFF AT' : 'DESTINATION'}</Copy>
        <Copy style={styles.destination}>{ride.destination?.label ?? ride.destinationArea}</Copy>
        {ride.destination && ride.destinationArea !== ride.destination.label && (
          <Copy style={styles.address}>{ride.destinationArea}</Copy>
        )}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  details: { gap: 14 },
  rider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#242424' },
  text: { flexShrink: 1, gap: 4 },
  name: { fontFamily: 'Manrope_700Bold', fontSize: 16, lineHeight: 23 },
  address: { fontSize: 12, lineHeight: 19, color: theme.muted },
  label: { fontFamily: 'Manrope_700Bold', fontSize: 11, letterSpacing: 0.88, color: theme.muted },
  destination: { fontFamily: 'Manrope_700Bold', fontSize: 17, lineHeight: 24 },
});
