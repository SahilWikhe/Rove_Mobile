import { useState } from 'react';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Brand, Button, Card, Copy, Field, Screen } from '@rove/mobile-ui';
export default function DriverHome() {
  const session = useSession();
  const [name, setName] = useState('');
  if (session.profile) return <Redirect href="/drive" />;
  return (
    <Screen>
      <Brand driver />
      {session.synthetic && <Banner message="Synthetic test mode · no real rides or payments" />}
      <View style={{ paddingTop: 48, gap: 20 }}>
        <Copy kind="label">MAKE EVERY MILE MATTER</Copy>
        <Copy kind="title">
          A new direction.{'\n'}With you at{'\n'}the wheel.
        </Copy>
        <Copy kind="muted">Clear trip details. Upfront earnings. Your next chapter with Rove.</Copy>
      </View>
      <Card>
        <Copy kind="heading">{session.needsProfile ? 'Let’s get you started.' : 'Drive with Rove.'}</Copy>
        {session.canRetryProfile ? (
          <>
            <Copy kind="muted">Your sign-in is saved. Retry loading your account to continue.</Copy>
            <Button
              title="Retry loading account"
              loading={session.loading}
              onPress={() => void session.retryProfile()}
            />
          </>
        ) : session.needsProfile ? (
          <>
            <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" />
            <Button
              title="Create driver account"
              disabled={!name.trim()}
              loading={session.loading}
              onPress={() => void session.register(name.trim())}
            />
          </>
        ) : (
          <>
            <Copy kind="muted">Sign in or create your driver account.</Copy>
            <Button
              title="Get started"
              disabled={!session.ready}
              loading={session.loading}
              onPress={() => void session.signIn()}
            />
          </>
        )}
      </Card>
      {session.error && <Banner error message={session.error} />}
    </Screen>
  );
}
