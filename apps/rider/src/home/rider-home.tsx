import { HomeNavigation } from '../navigation/rider-navigation';
import { SavedShortcuts } from './saved-shortcuts';
import { useCallback, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { RideDetails } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { Banner, Card, Copy, Screen, theme } from '@rove/mobile-ui';

import search from '../../assets/home/search.png';
import arrow from '../../assets/home/arrow.png';
import journey from '../../assets/home/journey.png';
const assets = { search, arrow, journey };
const gradient =
  'linear-gradient(139.87389642220478deg, rgb(240,220,174) 14.142%, rgb(220,185,116) 36.77%, rgb(198,156,76) 59.398%, rgb(227,198,138) 84.854%)';
// RN 0.86 native uses the experimental name; React Native Web uses CSS backgroundImage.
const gradientStyle = Platform.select({
  web: { backgroundImage: gradient } as ViewStyle,
  default: { experimental_backgroundImage: gradient } as ViewStyle,
});
const rideLabels: Record<RideDetails['state'], string> = {
  searching: 'Finding a driver',
  matched: 'Driver confirmed',
  en_route: 'Driver on the way',
  arrived: 'Driver has arrived',
  in_progress: 'On your way',
  completed: 'Trip completed',
  cancelled: 'Ride cancelled',
  no_driver_found: 'No driver found',
  no_show: 'Pickup not completed',
  interrupted: 'Trip needs attention',
  terminated: 'Trip ended',
};

/** Keyed by profile ID at the route boundary so another account never sees the prior account's rides. */
export function RiderHome({ name }: { name: string }) {
  const { api, synthetic } = useSession();
  const [latest, setLatest] = useState<RideDetails | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(
      () =>
        pollWhileForeground({
          load: (signal) => api.rides(undefined, signal),
          onData: ({ rides }) => {
            setLatest(rides[0] ?? null);
            setLoaded(true);
            setError(null);
          },
          onError: () => {
            setError('Your rides could not be refreshed. We’ll try again when connected.');
          },
          intervalMs: 15_000,
        }),
      [api],
    ),
  );
  const book = () => router.push('/book');
  return (
    <Screen contentStyle={styles.content} footer={<HomeNavigation />}>
      <Copy style={styles.greeting}>Where to, {name.trim().split(/\s+/)[0]}?</Copy>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Where are you going?"
        onPress={book}
        style={({ pressed }) => [styles.search, pressed && styles.pressed]}
      >
        <Image source={assets.search} style={{ width: 19, height: 19 }} accessible={false} />
        <Copy style={styles.searchText}>Where are you going?</Copy>
      </Pressable>
      <SavedShortcuts />
      {synthetic && <Copy style={styles.testLabel}>TEST MODE · NO REAL RIDES OR PAYMENTS</Copy>}
      <Copy style={styles.sectionTitle}>The latest for you</Copy>
      {error && <Banner error message={error} />}
      <Card style={styles.latestCard}>
        <Copy style={styles.eyebrow}>{latest ? 'YOUR LATEST RIDE' : 'YOUR JOURNEYS'}</Copy>
        {latest ? (
          <>
            <Copy style={styles.rideTitle}>{rideLabels[latest.state]}</Copy>
            <Copy kind="muted" style={styles.detail}>
              Requested{' '}
              {new Date(latest.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </Copy>
            <View style={styles.separator} />
            <Copy style={styles.detail}>
              {latest.pickupArea} → {latest.destinationArea}
            </Copy>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/ride', params: { id: latest.id } })}
              style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
            >
              <Copy style={styles.goldAction}>View ride details</Copy>
            </Pressable>
          </>
        ) : (
          <>
            <Copy style={styles.rideTitle}>
              {loaded ? 'Your first ride is ahead.' : error ? 'Rides unavailable' : 'Loading your rides…'}
            </Copy>
            <Copy kind="muted" style={styles.detail}>
              {loaded
                ? 'Once you request a ride, you can follow it here.'
                : 'Your latest trip will appear here after we connect.'}
            </Copy>
          </>
        )}
      </Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose a destination"
        onPress={book}
        style={({ pressed }) => [styles.promo, gradientStyle, pressed && styles.pressed]}
      >
        <View style={styles.promoContent}>
          <Copy style={styles.promoTitle}>Your next stop starts here</Copy>
          <Copy style={styles.promoBody}>
            Pick your destination and review your fare before you request a ride.
          </Copy>
          <View style={styles.promoAction}>
            <Copy style={styles.promoActionText}>Choose a destination</Copy>
            <Image source={assets.arrow} style={{ width: 17, height: 17 }} accessible={false} />
          </View>
        </View>
        <View style={styles.illustration}>
          <Image
            source={assets.journey}
            style={styles.illustrationImage}
            accessible={false}
            resizeMode="cover"
          />
        </View>
      </Pressable>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 30, gap: 16, paddingBottom: 24 },
  greeting: { fontFamily: 'Manrope_800ExtraBold', fontSize: 30, lineHeight: 38, letterSpacing: -0.6 },
  search: {
    minHeight: 56,
    borderWidth: 1.5,
    borderColor: theme.gold,
    backgroundColor: theme.raised,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  searchText: { fontFamily: 'Manrope_400Regular', color: theme.muted, fontSize: 15, flexShrink: 1 },
  testLabel: { color: theme.muted, fontSize: 10, lineHeight: 16, letterSpacing: 0.7 },
  sectionTitle: { fontFamily: 'Manrope_800ExtraBold', fontSize: 17, marginTop: 8 },
  latestCard: { padding: 18, borderRadius: 18, borderColor: 'rgba(255,255,255,0.07)', gap: 8 },
  eyebrow: { fontFamily: 'Manrope_700Bold', color: theme.muted, fontSize: 11, letterSpacing: 0.88 },
  rideTitle: { fontFamily: 'Manrope_700Bold', fontSize: 23, lineHeight: 31 },
  detail: { fontFamily: 'Manrope_400Regular', fontSize: 14, lineHeight: 21 },
  separator: { height: 1, backgroundColor: theme.border, marginVertical: 6 },
  textAction: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  goldAction: { color: theme.gold, fontSize: 14, fontFamily: 'Manrope_700Bold' },
  promo: { backgroundColor: theme.gold, borderRadius: 18, overflow: 'hidden' },
  promoContent: { paddingTop: 22, paddingHorizontal: 20, paddingBottom: 18, gap: 8 },
  promoTitle: { color: '#120D02', fontFamily: 'Manrope_800ExtraBold', fontSize: 21, lineHeight: 27 },
  promoBody: { color: 'rgba(18,13,2,0.8)', fontFamily: 'Manrope_400Regular', fontSize: 14, lineHeight: 20 },
  promoAction: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 8, flexWrap: 'wrap' },
  promoActionText: { fontFamily: 'Manrope_800ExtraBold', fontSize: 15, color: '#120D02' },
  illustration: { width: '100%', aspectRatio: 350 / 146 },
  illustrationImage: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  pressed: { opacity: 0.75 },
});
