import { Stack } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useSession } from '@rove/mobile-core/session';
import { Copy, Screen } from '@rove/mobile-ui';
import { SupportForm } from '@rove/mobile-ui/support-form';
export default function Support() {
  const { profile, api } = useSession();
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Help & support' }} />
      {profile ? (
        <SupportForm
          key={profile.id}
          list={() => api.supportRequests()}
          submit={(input, key) => api.createSupportRequest(input, key)}
          newKey={Crypto.randomUUID}
        />
      ) : (
        <Copy>Sign in to view your support requests.</Copy>
      )}
    </Screen>
  );
}
