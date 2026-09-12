import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { useMessageThread } from '@rove/mobile-core/use-messages';
import { MessageThreadView } from '@rove/mobile-ui/messages';
import { Copy, Screen } from '@rove/mobile-ui';
export default function Conversation() {
  const { profile } = useSession();
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {profile && typeof id === 'string' ? (
        <Thread key={profile.id + id} id={id} />
      ) : (
        <Screen>
          <Copy>Sign in to view this conversation.</Copy>
        </Screen>
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
      role="driver"
      back={() => router.replace('/messages')}
      openRide={(rideId) => router.push({ pathname: '/trip', params: { id: rideId } })}
    />
  );
}
