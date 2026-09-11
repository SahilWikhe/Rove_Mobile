import { RiderHome } from '../home/rider-home';
import { useState } from 'react';
import { View } from 'react-native';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Brand, Button, Card, Copy, EmailVerificationNotice, Field, Screen } from '@rove/mobile-ui';
export default function Home() {
  const session = useSession();
  const [name, setName] = useState('');
  if (!session.profile)
    return (
      <Screen>
        <Brand />
        <View style={{ paddingTop: 64, gap: 20 }}>
          <Copy kind="label">A NEW WAY TO GET THERE</Copy>
          <Copy kind="title">Life has places{'\n'}for you to be.</Copy>
          <Copy kind="muted">A ride to your next stop. A little more room for your day.</Copy>
        </View>
        <Card style={{ marginTop: 24 }}>
          <Copy kind="heading">
            {session.needsProfile ? 'Let’s get to know you.' : 'Your next stop starts here.'}
          </Copy>
          {session.needsEmailVerification ? (
            <EmailVerificationNotice loading={session.loading} onSignIn={() => void session.signIn()} />
          ) : session.canRetryProfile ? (
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
                title="Create your account"
                disabled={!name.trim()}
                loading={session.loading}
                onPress={() => void session.register(name.trim())}
              />
            </>
          ) : (
            <>
              <Copy kind="muted">Sign in or create an account to get moving.</Copy>
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
        <Copy kind="label">ROVE · YOUR JOURNEY, SIMPLIFIED</Copy>
      </Screen>
    );
  return <RiderHome key={session.profile.id} name={session.profile.name} />;
}
