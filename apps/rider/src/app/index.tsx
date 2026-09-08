import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Brand, Button, Card, Copy, Field, Screen, theme } from '@rove/mobile-ui';
export default function Home() {
  const session = useSession();
  const [name, setName] = useState('');
  if (!session.profile)
    return (
      <Screen>
        <Brand />
        {session.synthetic && <Banner message="Synthetic test mode · no real rides or payments" />}
        <View style={{ paddingTop: 64, gap: 20 }}>
          <Copy kind="label">A NEW WAY TO GET THERE</Copy>
          <Copy kind="title">Life has places{'\n'}for you to be.</Copy>
          <Copy kind="muted">A ride to your next stop. A little more room for your day.</Copy>
        </View>
        <Card style={{ marginTop: 24 }}>
          <Copy kind="heading">
            {session.needsProfile ? 'Let’s get to know you.' : 'Your next stop starts here.'}
          </Copy>
          {session.needsProfile ? (
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
              <Button title="Get started" loading={session.loading} onPress={() => void session.signIn()} />
            </>
          )}
        </Card>
        {session.error && <Banner error message={session.error} />}
        <Copy kind="label">ROVE · YOUR JOURNEY, SIMPLIFIED</Copy>
      </Screen>
    );
  return (
    <Screen>
      <Brand />
      {session.synthetic && <Banner message="Synthetic test mode · no real rides or payments" />}
      <View style={{ gap: 8 }}>
        <Copy kind="muted">Hello, {session.profile.name.split(' ')[0]}.</Copy>
        <Copy kind="title">Where are{'\n'}we headed?</Copy>
      </View>
      <Button title="⌕   Where to?" onPress={() => router.push('/book')} />
      <Card style={{ backgroundColor: theme.gold, borderColor: theme.gold, paddingVertical: 30 }}>
        <Copy kind="heading" style={{ color: theme.background }}>
          Your next stop{'\n'}starts here.
        </Copy>
        <Copy style={{ color: theme.background }}>Choose a destination.{'\n'}We’ll take it from there.</Copy>
      </Card>
      <Button title="My rides" variant="secondary" onPress={() => router.push('/rides')} />
      <Button title="Account & help" variant="secondary" onPress={() => router.push('/account')} />
    </Screen>
  );
}
