import chevron from '../../assets/trips/chevron.png';
import { DriverNavigation } from '../navigation/driver-navigation';
import { Fragment, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { useRidePage } from '@rove/mobile-core/use-ride-page';
import { Banner, Button, Copy, EmptyState, Screen, theme } from '@rove/mobile-ui';

export default function History() {
  const { profile } = useSession();
  return <HistoryBrowser key={profile?.id ?? 'signed-out'} />;
}
function HistoryBrowser() {
  const [cursors, setCursors] = useState<string[]>([]);
  const before = cursors.at(-1);
  return (
    <HistoryPage
      key={before ?? 'latest'}
      before={before}
      older={(cursor) => setCursors((current) => [...current, cursor])}
      newer={before ? () => setCursors((current) => current.slice(0, -1)) : undefined}
      latest={before ? () => setCursors([]) : undefined}
    />
  );
}
function HistoryPage({
  before,
  older,
  newer,
  latest,
}: {
  before: string | undefined;
  older: (cursor: string) => void;
  newer: (() => void) | undefined;
  latest: (() => void) | undefined;
}) {
  const { api, profile } = useSession();
  const { data, error, focus, refresh, refreshing } = useRidePage(api, before, Boolean(profile));
  useFocusEffect(focus);
  return (
    <Screen
      contentStyle={{ padding: 20, gap: 16 }}
      onRefresh={profile ? refresh : undefined}
      refreshing={refreshing}
      footer={profile ? <DriverNavigation active="/trips" /> : undefined}
    >
      <Stack.Screen options={{ title: 'Your trips', headerShown: false }} />
      <Copy kind="title" style={styles.title}>
        Trips
      </Copy>
      <Copy kind="muted" style={styles.subtitle}>
        Your rides and their latest status
      </Copy>
      {newer && <Button title="Newer trips" variant="secondary" onPress={newer} />}
      {latest && <Button title="Back to latest trips" variant="secondary" onPress={latest} />}
      {error && <Banner error message={error} />}
      {profile && error && <Button title="Retry" variant="secondary" onPress={refresh} />}
      {!profile ? (
        <Copy kind="muted">Sign in to view your trips.</Copy>
      ) : !data && !error ? (
        <Copy kind="muted">Loading trips…</Copy>
      ) : null}
      {data?.rides.length === 0 && (
        <EmptyState
          title={before ? 'No earlier trips.' : 'Your history starts here.'}
          message={
            before
              ? 'Return to the latest trips to refresh your history.'
              : 'Your trips will appear here with their current status.'
          }
        />
      )}
      {data?.rides.map((ride, index) => {
        const recorded = new Date(ride.createdAt);
        const previous = data.rides[index - 1];
        const showDate = !previous || new Date(previous.createdAt).toDateString() !== recorded.toDateString();
        const status = ride.state.replaceAll('_', ' ');
        return (
          <Fragment key={ride.id}>
            {showDate && (
              <Copy kind="label" style={styles.date}>
                {recorded
                  .toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })
                  .toUpperCase()}
              </Copy>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${ride.pickupArea} to ${ride.destinationArea}, ${status}, ${recorded.toLocaleString()}`}
              testID={`driver-trip-${ride.id}`}
              onPress={() => router.push({ pathname: '/trip', params: { id: ride.id } })}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
            >
              <View style={styles.topRow}>
                <Copy style={styles.time}>
                  {recorded.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </Copy>
                <View style={styles.badge}>
                  <Copy style={styles.status}>{status}</Copy>
                </View>
              </View>
              <View style={styles.routeRow}>
                <View style={styles.route}>
                  <Copy style={styles.routeLabel}>From {ride.pickupArea}</Copy>
                  <Copy kind="muted" style={styles.destination}>
                    To {ride.destinationArea}
                  </Copy>
                </View>
                <Image source={chevron} style={styles.chevron} accessible={false} />
              </View>
              <View style={styles.divider} />
              <Copy kind="muted" style={styles.subtitle}>
                View trip details
              </Copy>
            </Pressable>
          </Fragment>
        );
      })}
      {data?.nextCursor && (
        <Button title="Older trips" variant="secondary" onPress={() => older(data.nextCursor!)} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, letterSpacing: -0.52, fontFamily: 'Manrope_800ExtraBold' },
  subtitle: { fontSize: 13, lineHeight: 20 },
  date: { color: theme.muted, fontSize: 11, letterSpacing: 0.88, marginTop: 4 },
  card: {
    padding: 16,
    gap: 12,
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  time: { fontSize: 18, fontFamily: 'Manrope_800ExtraBold' },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(214,178,109,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(214,178,109,0.4)',
    maxWidth: '100%',
  },
  status: { color: theme.gold, fontSize: 11, fontFamily: 'Manrope_700Bold', textTransform: 'capitalize' },
  routeRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  route: { flex: 1, gap: 4 },
  routeLabel: { fontFamily: 'Manrope_700Bold', fontSize: 14, lineHeight: 22 },
  destination: { fontSize: 12, lineHeight: 20 },
  chevron: { width: 17, height: 17, resizeMode: 'contain' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },
});
