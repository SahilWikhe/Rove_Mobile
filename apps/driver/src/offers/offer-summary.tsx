import { Image, StyleSheet, View } from 'react-native';
import type { DriverOffer } from '@rove/contracts';
import { Copy, theme } from '@rove/mobile-ui';
import route from '../../assets/offers/route.png';

/** Figma 2:2, adapted to the strict pre-acceptance offer contract. */
export function OfferSummary({ offer, remaining }: { offer: DriverOffer; remaining: number }) {
  return (
    <>
      <View style={styles.heading}>
        <View style={styles.grow}>
          <Copy kind="heading" style={styles.title}>
            New ride request
          </Copy>
          <Copy style={styles.service}>
            {offer.service === 'accessible' ? 'Wheelchair-accessible service' : 'Standard ride'}
          </Copy>
        </View>
        <View
          accessible
          accessibilityLabel={remaining ? `${remaining} seconds to respond` : 'Offer expired'}
          style={styles.countdown}
        >
          <Copy style={styles.seconds}>{remaining}</Copy>
        </View>
      </View>
      {!remaining && <Copy style={styles.service}>OFFER EXPIRED</Copy>}
      <View style={styles.estimates}>
        <View style={styles.grow}>
          <Copy style={styles.amount}>
            {new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: offer.estimatedEarnings.currency,
            }).format(offer.estimatedEarnings.amount / 100)}
          </Copy>
          <Copy kind="muted" style={styles.small}>
            Estimated earnings
          </Copy>
        </View>
        <View style={styles.duration}>
          <Copy style={styles.detail}>
            {(offer.distanceMeters / 1609.344).toFixed(1)} mi · {Math.ceil(offer.tripSeconds / 60)} min
          </Copy>
          <Copy kind="muted" style={styles.small}>
            {Math.ceil(offer.pickupSeconds / 60)} min to pickup
          </Copy>
        </View>
      </View>
      <View style={styles.divider} />
      <View style={styles.route}>
        <Image source={route} style={styles.routeIcon} accessible={false} />
        <View style={[styles.grow, styles.areas]}>
          <View>
            <Copy kind="label">PICKUP AREA</Copy>
            <Copy style={styles.area}>{offer.pickupArea}</Copy>
          </View>
          <View>
            <Copy kind="label">DROP-OFF AREA</Copy>
            <Copy style={styles.area}>{offer.destinationArea}</Copy>
          </View>
        </View>
      </View>
      <Copy kind="muted" style={styles.small}>
        Exact trip details are available after you accept.
      </Copy>
    </>
  );
}
const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, lineHeight: 26 },
  service: { color: theme.gold, fontSize: 12, lineHeight: 18 },
  countdown: {
    minWidth: 48,
    minHeight: 48,
    padding: 6,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seconds: { color: theme.gold, fontFamily: 'Manrope_700Bold', fontSize: 17 },
  estimates: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 },
  amount: { color: theme.gold, fontFamily: 'Manrope_700Bold', fontSize: 30, lineHeight: 40 },
  small: { fontSize: 12, lineHeight: 19 },
  detail: { fontSize: 13, lineHeight: 20, fontFamily: 'Manrope_700Bold' },
  duration: { flexShrink: 1, alignItems: 'flex-end' },
  divider: { height: 1, backgroundColor: theme.border },
  route: { flexDirection: 'row', gap: 12 },
  routeIcon: { width: 9, height: 63, marginTop: 23 },
  areas: { gap: 16 },
  area: { fontSize: 14, lineHeight: 22, fontFamily: 'Manrope_700Bold' },
});
