import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { useMessageThread } from '@rove/mobile-core/use-messages';
import { MessageThreadView } from '@rove/mobile-ui/messages';
import { Button, Copy, Screen } from '@rove/mobile-ui';
import { Conversation as ConversationSchema } from '@rove/contracts';
export default function Conversation() {
  const { profile, ready } = useSession();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const parsed = ConversationSchema.shape.id.safeParse(id);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {!ready ? (
        <Screen>
          <Copy kind="muted">Restoring your account…</Copy>
        </Screen>
      ) : !profile ? (
        <Screen>
          <Copy kind="heading">Sign in to view this conversation</Copy>
          <Copy kind="muted">Open your account to sign in or finish setup, then choose Messages.</Copy>
          <Button title="Continue to your account" onPress={() => router.replace('/')} />
        </Screen>
      ) : !parsed.success ? (
        <Screen>
          <Copy kind="heading">This conversation link is incomplete</Copy>
          <Copy kind="muted">Choose a conversation from Messages to continue.</Copy>
          <Button title="Open Messages" onPress={() => router.replace('/messages')} />
        </Screen>
      ) : (
        <Thread key={`${profile.id}:${parsed.data}`} id={parsed.data} />
      )}
    </>
  );
}
function Thread({ id }: { id: string }) {
  const { api } = useSession();
  const state = useMessageThread(api, id, true);
  useFocusEffect(state.focus);
  return (
    <MessageThreadView
      {...state}
      role="rider"
      back={() => router.replace('/messages')}
      openRide={(rideId) => router.push({ pathname: '/ride', params: { id: rideId } })}
    />
  );
}
