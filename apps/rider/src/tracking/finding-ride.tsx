import car from '../../assets/finding/car.png';
import inner from '../../assets/finding/inner.png';
import outer from '../../assets/finding/outer.png';
import { Image, StyleSheet, View } from 'react-native';
import { Copy } from '@rove/mobile-ui';

export function FindingRide({ reconnecting }: { reconnecting: boolean }) {
  return (
    <View style={styles.hero}>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.rings}
      >
        <Image source={outer} style={styles.outer} />
        <Image source={inner} style={styles.inner} />
        <View style={styles.badge}>
          <Image source={car} style={styles.car} />
        </View>
      </View>
      <Copy kind="heading" style={styles.title}>
        {reconnecting ? 'Reconnecting to your ride…' : 'Finding your ride.'}
      </Copy>
      <Copy kind="muted" style={styles.caption}>
        {reconnecting ? 'Waiting for current ride information.' : 'Matching you with a nearby Rove driver'}
      </Copy>
    </View>
  );
}
const styles = StyleSheet.create({
  hero: {
    flexGrow: 1,
    minHeight: 300,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  rings: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  outer: { position: 'absolute', width: 150, height: 150 },
  inner: { position: 'absolute', width: 115, height: 115 },
  badge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
  },
  car: { width: 34, height: 34 },
  title: { fontSize: 19, lineHeight: 27, textAlign: 'center' },
  caption: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
