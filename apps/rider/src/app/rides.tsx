import chevron from '../../assets/account/history-chevron.png';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { accountContent, accountTitle } from '@rove/mobile-ui/account-layout';
import { HomeNavigation } from '../navigation/rider-navigation';
import { useState } from 'react';
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
      contentStyle={accountContent}
      refreshing={refreshing}
      onRefresh={profile ? refresh : undefined}
      footer={profile ? <HomeNavigation active="/rides" /> : undefined}
    >
      <Stack.Screen options={{ title: 'My rides', headerShown: false }} />
      <Copy style={accountTitle}>My rides</Copy>
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
      {data?.rides.map((ride) => {
        const requested = new Date(ride.createdAt);
        const status = ride.state.replaceAll('_', ' ');
        return (
          <Pressable
            key={ride.id}
            testID={`rider-history-${ride.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${ride.pickupArea} to ${ride.destinationArea}, ${status}, requested ${requested.toLocaleString()}`}
            onPress={() => router.push({ pathname: '/ride', params: { id: ride.id } })}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
          >
            <View style={styles.row}>
              <Copy style={styles.date}>
                {requested.toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Copy>
              <Copy style={styles.status}>{status}</Copy>
            </View>
            <Copy style={styles.time}>
              Requested {requested.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </Copy>
            <Copy style={styles.route}>
              {ride.pickupArea} → {ride.destinationArea}
            </Copy>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Copy style={styles.details}>View ride details</Copy>
              <Image source={chevron} style={{ width: 17, height: 17 }} accessible={false} />
            </View>
          </Pressable>
        );
      })}
      {data?.nextCursor && (
        <Button title="Older trips" variant="secondary" onPress={() => older(data.nextCursor!)} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: 13, lineHeight: 19 },
  card: {
    backgroundColor: theme.surface,
    borderColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  date: { color: theme.muted, fontSize: 13, lineHeight: 19, flex: 1 },
  status: {
    color: theme.gold,
    fontFamily: 'Manrope_700Bold',
    fontSize: 11,
    lineHeight: 16,
    maxWidth: '45%',
    textAlign: 'right',
    textTransform: 'capitalize',
  },
  time: { fontFamily: 'Manrope_700Bold', fontSize: 18, lineHeight: 26 },
  route: { color: theme.muted, fontSize: 13, lineHeight: 20 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginVertical: 8 },
  details: { fontFamily: 'Manrope_700Bold', fontSize: 14, lineHeight: 20, flex: 1 },
});
