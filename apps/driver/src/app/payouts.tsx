import { Platform } from 'react-native';
import { useCallback, useRef, useState } from 'react';
import { Stack, router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { type DriverPayoutStatus } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, Screen } from '@rove/mobile-ui';
export default function Payouts() {
  const { profile } = useSession();
  return <PayoutSetup key={profile?.id ?? 'signed-out'} />;
}
function PayoutSetup() {
  const { api, profile } = useSession();
  const [status, setStatus] = useState<DriverPayoutStatus['status'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0),
    pending = useRef(false);
  useFocusEffect(
    useCallback(() => {
      void revision;
      const generation = ++epoch.current;
      const abort = new AbortController();
      setStatus(null);
      setError(null);
      if (profile)
        void api
          .driverPayoutStatus(abort.signal)
          .then((result) => {
            if (epoch.current === generation) setStatus(result.status);
          })
          .catch((failure) => {
            if (epoch.current === generation)
              setError(failure instanceof Error ? failure.message : 'Unable to check payout setup.');
          })
          .finally(() => {
            if (epoch.current === generation) setRefreshing(false);
          });
      return () => {
        epoch.current++;
        abort.abort();
      };
    }, [api, profile, revision]),
  );
  async function start() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const generation = epoch.current;
    try {
      const link = await api.driverPayoutLink();
      if (epoch.current !== generation) return;
      // The shared response contract permits only Stripe HTTPS hosts. Never persist or log one-use links.
      await WebBrowser.openBrowserAsync(link.url);
      if (epoch.current === generation) setRevision((value) => value + 1);
    } catch (failure) {
      if (epoch.current === generation)
        setError(failure instanceof Error ? failure.message : 'Unable to open payout setup.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const titles = {
    unavailable: 'Payout setup is not available yet.',
    not_started: 'Set up your payouts.',
    pending: 'Your setup is still pending.',
    needs_information: 'Finish your Stripe details.',
    ready: 'Stripe details are ready.',
  };
  return (
    <Screen
      underHeader
      refreshing={refreshing}
      onRefresh={
        profile && !busy
          ? () => {
              setRefreshing(true);
              setRevision((value) => value + 1);
            }
          : undefined
      }
    >
      <Stack.Screen options={{ title: 'Payout setup' }} />
      <Copy kind="title">Your payout details.</Copy>
      {!profile ? (
        <Copy>Sign in as a driver to continue.</Copy>
      ) : (
        <>
          <Card>
            <Copy kind="heading">
              {status
                ? titles[status]
                : error
                  ? 'Payout status could not be checked.'
                  : 'Checking payout setup…'}
            </Copy>
            <Copy>
              Stripe collects identity and bank details securely. Rove does not collect those details in this
              form.
            </Copy>
            <Copy kind="muted">
              Payout setup is separate from vehicle and document approval. This screen does not transfer money
              or confirm that you can go online.
            </Copy>
          </Card>
          {error && <Banner error message={error} />}
          {status && status !== 'unavailable' && (
            <Button
              title={status === 'ready' ? 'Review Stripe details' : 'Continue with Stripe'}
              loading={busy}
              onPress={() => void start()}
            />
          )}
          {Platform.OS === 'web' && (
            <Button
              title="Check setup status"
              variant="secondary"
              disabled={busy}
              onPress={() => setRevision((value) => value + 1)}
            />
          )}
          <Copy kind="muted">
            {Platform.OS === 'web'
              ? 'After completing or closing Stripe, check your status here.'
              : 'Pull down to check your status after returning from Stripe.'}{' '}
            If a link expires, select Continue with Stripe to request a new one.
          </Copy>
        </>
      )}
      {profile && (
        <Button
          title="Help with payout setup"
          variant="secondary"
          disabled={busy}
          onPress={() => router.push('/support')}
        />
      )}
    </Screen>
  );
}
