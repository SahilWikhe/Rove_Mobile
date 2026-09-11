import { Stack } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { Screen, Copy } from '@rove/mobile-ui';
import { ProfileNameForm } from '@rove/mobile-ui/profile-name-form';
export default function Profile() {
  const { profile, updateName, reloadName } = useSession();
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Edit profile' }} />
      {profile ? (
        <ProfileNameForm key={profile.id} initialName={profile.name} save={updateName} reload={reloadName} />
      ) : (
        <Copy>Sign in to edit your profile.</Copy>
      )}
    </Screen>
  );
}
