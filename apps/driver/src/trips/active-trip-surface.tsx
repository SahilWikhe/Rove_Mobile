import type { PropsWithChildren, ReactNode } from 'react';
import { useState } from 'react';
import { router } from 'expo-router';
import { Animated, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RideDetails } from '@rove/contracts';
import { Copy, Screen, theme } from '@rove/mobile-ui';
import { TripMap } from '@rove/mobile-ui/trip-map';
import { useDriveSheet } from '../home/use-drive-sheet';

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
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const collapsedHeight = Math.max(220, Math.min(460, height * 0.43)) + insets.top;
  const expandedHeight = Math.min(collapsedHeight - 40, insets.top + 140 + 25 * fontScale);
  const sheet = useDriveSheet(collapsedHeight - expandedHeight);
  const [mapHeight, setMapHeight] = useState(collapsedHeight);
  const caption = ride && ride.state in captions ? captions[ride.state as keyof typeof captions] : null;
  if (!caption || !ride?.pickup || !ride.destination) return <Screen footer={footer}>{children}</Screen>;
  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <View style={StyleSheet.absoluteFill}>
        <TripMap
          key={ride.id}
          pickup={ride.pickup.coordinate}
          destination={ride.destination.coordinate}
          synthetic={synthetic}
          androidEnabled={!!process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY}
          iosEnabled={!!process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY}
          fill
          floating
          bottomInset={Math.max(0, height - mapHeight)}
          topInset={insets.top + 12 + 22 + 25 * fontScale}
        />
      </View>
      <Animated.View
        pointerEvents="box-none"
        onLayout={(event) => setMapHeight(event.nativeEvent.layout.height)}
        style={{
          height: sheet.progress.interpolate({
            inputRange: [0, 1],
            outputRange: [collapsedHeight, expandedHeight],
          }),
          overflow: 'hidden',
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to driving"
          accessibilityHint="Returns to driving without changing your active trip"
          onPress={() => router.replace('/drive')}
          style={({ pressed }) => [styles.back, { top: insets.top + 12 }, pressed && styles.backPressed]}
        >
          <View accessible={false} style={styles.chevron} />
        </Pressable>
        <View style={[styles.status, { top: insets.top + 12 }]} pointerEvents="none">
          <Copy style={styles.statusText}>{caption}</Copy>
        </View>
      </Animated.View>
      <View style={styles.sheet} {...sheet.panHandlers}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sheet.expanded ? 'Collapse trip panel' : 'Expand trip panel'}
          accessibilityState={{ expanded: sheet.expanded }}
          onPress={sheet.toggle}
          style={styles.handleTarget}
        >
          <View style={styles.handle} />
        </Pressable>
        <ScrollView
          style={{ flex: 1 }}
          scrollEnabled={sheet.expanded}
          onScroll={(event) => {
            sheet.scrollY.current = Math.max(0, event.nativeEvent.contentOffset.y);
          }}
          scrollEventThrottle={16}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {footer && (
          <ScrollView
            style={{ flexGrow: 0, maxHeight: height * 0.4 }}
            contentContainerStyle={[styles.actions, { paddingBottom: insets.bottom + 12 }]}
            keyboardShouldPersistTaps="handled"
          >
            {footer}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  back: {
    position: 'absolute',
    left: 12,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,12,12,0.72)',
    borderWidth: 1,
    borderColor: theme.border,
  },
  backPressed: { backgroundColor: 'rgba(35,35,35,0.92)' },
  chevron: {
    width: 11,
    height: 11,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: theme.text,
    transform: [{ translateX: 2 }, { rotate: '45deg' }],
  },
  status: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '64%',
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
    marginHorizontal: 12,
    marginTop: 12,
    backgroundColor: 'rgba(10,10,10,0.96)',
    borderRadius: 28,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  handleTarget: { height: 48, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 44, height: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.3)' },
  actions: { padding: 16, paddingTop: 10 },
  content: { padding: 20, paddingTop: 0, gap: 14, paddingBottom: 24 },
});
