import { useCallback } from 'react';
import { router, Stack } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useSession } from '@rove/mobile-core/session';
import { Button, Copy, Screen } from '@rove/mobile-ui';
import { SupportForm } from '@rove/mobile-ui/support-form';
export default function AccountDeletion() {
  const { profile, api, ready } = useSession();
  const list = useCallback(async () => {
    const [support, deletion] = await Promise.all([api.supportRequests(), api.accountDeletionStatus()]);
    return { ...support, deletionRequest: deletion.request };
  }, [api]);
  return (
    <>
      <Stack.Screen options={{ title: 'Account deletion' }} />
      {!ready ? (
        <Screen underHeader>
          <Copy kind="muted">Restoring your account…</Copy>
        </Screen>
      ) : profile ? (
        <SupportForm
          accountDeletion
          key={profile.id}
          list={list}
          submit={(input, key) => api.createSupportRequest(input, key)}
          withdraw={(id, key) => api.withdrawAccountDeletion(id, key)}
          newKey={Crypto.randomUUID}
        />
      ) : (
        <Screen underHeader>
          <Copy kind="heading">Sign in to manage your deletion request</Copy>
          <Copy kind="muted">
            Open your account to sign in or finish setup, then choose Request account deletion.
          </Copy>
          <Button title="Continue to your account" onPress={() => router.replace('/')} />
        </Screen>
      )}
    </>
  );
}
