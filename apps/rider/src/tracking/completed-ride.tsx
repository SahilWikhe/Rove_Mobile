import { Image, StyleSheet, View } from 'react-native';
import type { RideDetails } from '@rove/contracts';
import { Copy, theme } from '@rove/mobile-ui';
import check from '../../assets/completed-ride/check.png';

/** Rider Figma 6:107. Completion is separate from payment settlement. */
export function CompletedRide({ ride }: { ride: RideDetails }) {
  return (
    <View style={styles.hero}>
      <View style={styles.badge}>
        <Image source={check} style={styles.icon} accessible={false} />
      </View>
      <Copy kind="title" style={styles.title}>
        You’ve arrived.
      </Copy>
      <Copy kind="muted" style={styles.destination}>
        {ride.destination?.label ?? ride.destinationArea}
      </Copy>
      <Copy kind="muted" style={styles.payment}>
        {ride.paymentState === 'paid'
          ? 'Your payment is recorded. View your receipt below.'
          : ride.paymentState === 'review_required'
            ? 'Your ride is complete. Your payment is being reviewed.'
            : 'Your ride is complete. Your payment record is still updating.'}
      </Copy>
    </View>
  );
}
const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, paddingVertical: 18 },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(214,178,109,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(214,178,109,0.4)',
    marginBottom: 8,
  },
  icon: { width: 30, height: 30 },
  title: { fontSize: 22, lineHeight: 30, color: theme.text, textAlign: 'center' },
  destination: { textAlign: 'center', fontSize: 13, lineHeight: 20 },
  payment: { textAlign: 'center', fontSize: 13, lineHeight: 20, maxWidth: 320 },
});
