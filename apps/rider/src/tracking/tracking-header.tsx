import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { RideDetails } from '@rove/contracts';
import { Copy, theme } from '@rove/mobile-ui';
import back from '../../assets/tracking/back.png';
import account from '../../assets/tracking/account.png';
import dot from '../../assets/tracking/status-dot.png';

export const trackingCaptions: Partial<Record<RideDetails['state'], string>> = {
  matched: 'Driver assigned',
  en_route: 'Driver approaching',
  arrived: 'Driver at pickup',
  in_progress: 'On your way',
  interrupted: 'Trip interrupted',
};

/** Figma rider 6:22–6:36; native safe area is owned by the surrounding Screen. */
export function TrackingHeader({
  caption,
  onBack,
  onAccount,
}: {
  caption: string;
  onBack: () => void;
  onAccount: () => void;
}) {
  return (
    <>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to rides"
          onPress={onBack}
          style={styles.target}
        >
          <View style={styles.circle}>
            <Image source={back} style={styles.icon} accessible={false} />
          </View>
        </Pressable>
        <Copy style={styles.brand}>
          rove<Copy style={styles.dot}>·</Copy>
        </Copy>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your account"
          onPress={onAccount}
          style={styles.target}
        >
          <View style={styles.circle}>
            <Image source={account} style={styles.icon} accessible={false} />
          </View>
        </Pressable>
      </View>
      <View style={styles.status}>
        <Image source={dot} style={{ width: 6, height: 6 }} accessible={false} />
        <Copy style={styles.caption}>{caption}</Copy>
      </View>
    </>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  target: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  circle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { width: 15, height: 15 },
  brand: { fontFamily: 'Manrope_800ExtraBold', fontSize: 17, lineHeight: 25, letterSpacing: -0.34 },
  dot: { color: theme.gold, fontSize: 17 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    maxWidth: '100%',
  },
  caption: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
