import { useState } from 'react';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { useMessageInbox } from '@rove/mobile-core/use-messages';
import { MessageInbox } from '@rove/mobile-ui/messages';
import { Copy, Screen } from '@rove/mobile-ui';
import { HomeNavigation } from '../navigation/rider-navigation';
import type { ConversationList } from '@rove/contracts';
export default function Messages() {
  const { profile } = useSession();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {profile ? (
        <Browser key={profile.id} />
      ) : (
        <Screen>
          <Copy>Sign in to view messages.</Copy>
        </Screen>
      )}
    </>
  );
}
function Browser() {
  const [cursors, setCursors] = useState<NonNullable<ConversationList['nextCursor']>[]>([]);
  const cursor = cursors.at(-1);
  return (
    <Page
      key={cursor?.beforeId ?? 'latest'}
      cursor={cursor}
      older={(c) => setCursors((v) => [...v, c])}
      newer={cursor ? () => setCursors((v) => v.slice(0, -1)) : undefined}
    />
  );
}
function Page({
  cursor,
  older,
  newer,
}: {
  cursor: NonNullable<ConversationList['nextCursor']> | undefined;
  older: (c: NonNullable<ConversationList['nextCursor']>) => void;
  newer: (() => void) | undefined;
}) {
  const { api } = useSession();
  const state = useMessageInbox(api, true, cursor);
  useFocusEffect(state.focus);
  const next = state.data?.nextCursor;
  return (
    <MessageInbox
      conversations={state.data?.conversations ?? []}
      loaded={!!state.data}
      error={state.error}
      role="rider"
      footer={<HomeNavigation active="/messages" />}
      open={(id) => router.push({ pathname: '/conversation', params: { id } })}
      refresh={state.refresh}
      refreshing={state.refreshing}
      {...(next ? { older: () => older(next) } : {})}
      {...(newer ? { newer } : {})}
    />
  );
}
