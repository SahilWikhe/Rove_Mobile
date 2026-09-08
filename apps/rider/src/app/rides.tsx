import { useState } from 'react';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { useRidePage } from '@rove/mobile-core/use-ride-page';
import { Banner, Button, Copy, EmptyState, Screen } from '@rove/mobile-ui';

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
  const { data, error, focus, refresh } = useRidePage(api, before, Boolean(profile));
  useFocusEffect(focus);
  return (
    <Screen>
      <Stack.Screen options={{ title: 'My rides' }} />
      <Copy kind="title">Your journeys.</Copy>
      {newer && <Button title="Newer trips" variant="secondary" onPress={newer} />}
      {latest && <Button title="Back to latest trips" variant="secondary" onPress={latest} />}
      {error && <Banner error message={error} />}
      {profile && <Button title={error ? 'Retry' : 'Refresh'} variant="secondary" onPress={refresh} />}
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
      {data?.rides.map((ride) => (
        <Button
          key={ride.id}
          variant="secondary"
          title={`${ride.destinationArea} · ${ride.state.replaceAll('_', ' ')} · ${new Date(ride.createdAt).toLocaleDateString()}`}
          onPress={() => router.push({ pathname: '/ride', params: { id: ride.id } })}
        />
      ))}
      {data?.nextCursor && (
        <Button title="Older trips" variant="secondary" onPress={() => older(data.nextCursor!)} />
      )}
    </Screen>
  );
}
