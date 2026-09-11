import { Image, StyleSheet, View } from 'react-native';
import type { RideDetails } from '@rove/contracts';
import { Card, Copy, theme } from '@rove/mobile-ui';
import avatar from '../../assets/tracking/driver-avatar.png';

const status = {
  matched: 'Driver confirmed',
  en_route: 'Heading to your pickup',
  arrived: 'Waiting at your pickup',
  in_progress: 'Ride in progress',
  interrupted: 'Trip needs attention',
} as const;

/** Rider Figma 6:70. Stages come from committed state, never an invented percentage. */
export function DriverSummary({ ride }: { ride: RideDetails }) {
  const caption = status[ride.state as keyof typeof status];
  if (!caption || !ride.driver) return null;
  const onboard = ride.state === 'in_progress';
  return (
    <Card style={styles.card}>
      <View style={styles.identity}>
        <Image source={avatar} style={styles.avatar} accessible={false} />
        <View style={styles.details}>
          <Copy kind="label">YOUR DRIVER</Copy>
          <Copy style={styles.name}>{ride.driver.name}</Copy>
          <Copy style={styles.caption}>{caption}</Copy>
        </View>
      </View>
      {ride.state !== 'interrupted' && (
        <View style={styles.stages} accessibilityLabel={`Trip stage: ${onboard ? 'Ride' : 'Pickup'}`}>
          {['Pickup', 'Ride', 'Arrive'].map((label, index) => {
            const current = index === (onboard ? 1 : 0);
            const reached = index <= (onboard ? 1 : 0);
            return (
              <View key={label} style={styles.stage}>
                <View style={[styles.line, reached && styles.reached]} />
                <Copy style={[styles.stageText, current && styles.current]}>
                  {label}
                  {current ? ' · now' : ''}
                </Copy>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}
const styles = StyleSheet.create({
  card: { padding: 18, borderRadius: 18, gap: 16 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#33291C' },
  details: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontFamily: 'Manrope_700Bold', fontSize: 14, lineHeight: 21 },
  caption: { color: theme.muted, fontSize: 12, lineHeight: 18 },
  stages: { flexDirection: 'row', gap: 8, paddingTop: 12, borderTopWidth: 1, borderColor: theme.border },
  stage: { flex: 1, minWidth: 0, gap: 8 },
  line: { height: 3, borderRadius: 999, backgroundColor: theme.border },
  reached: { backgroundColor: theme.gold },
  stageText: { fontSize: 11, lineHeight: 17, color: theme.muted },
  current: { color: theme.gold, fontFamily: 'Manrope_700Bold' },
});
