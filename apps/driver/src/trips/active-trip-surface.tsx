import type { PropsWithChildren, ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RideDetails } from '@rove/contracts';
import { Copy, Screen, theme } from '@rove/mobile-ui';
import { TripMap } from '@rove/mobile-ui/trip-map';

const captions = {
  matched: 'Ride accepted · ready for pickup',
  en_route: 'Heading to pickup',
  arrived: 'Waiting at pickup',
  in_progress: 'Rider on board',
  interrupted: 'Trip interrupted',
} as const;

/** Figma 2:108 / 2:186. No invented ETA, route progress, or rider notes. */
export function ActiveTripSurface({
  ride,
  synthetic,
  children,
  footer,
}: PropsWithChildren<{
  ride: RideDetails | null;
  synthetic: boolean;
  footer?: ReactNode;
}>) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const caption = ride && ride.state in captions ? captions[ride.state as keyof typeof captions] : null;
  if (!caption || !ride?.pickup || !ride.destination) return <Screen footer={footer}>{children}</Screen>;
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <View style={{ height: Math.max(220, Math.min(460, height * 0.43)) + insets.top }}>
        <TripMap
          key={ride.id}
          pickup={ride.pickup.coordinate}
          destination={ride.destination.coordinate}
          synthetic={synthetic}
          androidEnabled={!!process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY}
          iosEnabled={!!process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY}
          fill
        />
        <View style={[styles.status, { top: insets.top + 12 }]} pointerEvents="none">
          <Copy style={styles.statusText}>{caption}</Copy>
        </View>
      </View>
      <ScrollView
        style={styles.sheet}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer && (
        <ScrollView
          style={{ flexGrow: 0, maxHeight: height * 0.45 }}
          contentContainerStyle={styles.actions}
          keyboardShouldPersistTaps="handled"
        >
          {footer}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  status: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '90%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(18,18,18,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(214,178,109,0.45)',
  },
  statusText: { fontFamily: 'Manrope_700Bold', fontSize: 13, color: theme.text, textAlign: 'center' },
  sheet: {
    flex: 1,
    backgroundColor: theme.raised,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: theme.border,
  },
  actions: { padding: 16, paddingTop: 10, backgroundColor: theme.raised },
  content: { padding: 20, gap: 14, paddingBottom: 24 },
});
