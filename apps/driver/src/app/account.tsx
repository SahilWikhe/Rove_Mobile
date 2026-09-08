import { Stack } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { Card, Copy, Screen } from '@rove/mobile-ui';
import { ProfileNameForm } from '@rove/mobile-ui/profile-name-form';

export default function Account() {
  const { profile, updateName, reloadName } = useSession();
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Account' }} />
      <Copy kind="title">Your space.</Copy>
      {profile ? (
        <>
          <Card>
            <Copy kind="heading">{profile.name}</Copy>
            <Copy kind="muted">Rove driver</Copy>
          </Card>
          <ProfileNameForm
            key={profile.id}
            initialName={profile.name}
            save={updateName}
            reload={reloadName}
          />
          <Copy kind="muted">
            Changing this name does not change your verified identity, driver approval or payout details.
          </Copy>
        </>
      ) : (
        <Copy kind="muted">Sign in to view your profile.</Copy>
      )}
    </Screen>
  );
}
