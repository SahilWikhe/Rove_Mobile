import { useCallback, useEffect, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { RideSummary } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Copy, Screen } from '@rove/mobile-ui';
import { SupportForm } from '@rove/mobile-ui/support-form';
export default function Support() {
  const { profile } = useSession();
  const params = useLocalSearchParams<{ rideId?: string; category?: string }>();
  return <SupportContent key={`${profile?.id}:${params.rideId}:${params.category}`} {...params} />;
}
function SupportContent({ rideId, category }: { rideId?: string; category?: string }) {
  const { profile, api } = useSession();
  const list = useCallback(() => api.supportRequests(), [api]);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState(false);
  const [general, setGeneral] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!rideId || !profile || general) return;
    const controller = new AbortController();
    let active = true;
    setVerified(false);
    setError(false);
    if (!RideSummary.shape.id.safeParse(rideId).success) {
      setError(true);
      return;
    }
    void api
      .ride(rideId, controller.signal)
      .then((ride) => {
        if (active) {
          setVerified(ride.id === rideId);
          setError(ride.id !== rideId);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, rideId, profile, general, retry]);
  return (
    <>
      <Stack.Screen options={{ title: 'Help & support' }} />
      {!profile ? (
        <Screen underHeader>
          <Copy>Sign in to view your support requests.</Copy>
        </Screen>
      ) : rideId && !general && !verified ? (
        <Screen underHeader>
          {error ? (
            <>
              <Banner error message="This ride could not be verified. Retry or open general support." />
              <Button title="Retry ride details" onPress={() => setRetry((value) => value + 1)} />
              <Button title="Open general support" variant="secondary" onPress={() => setGeneral(true)} />
            </>
          ) : (
            <Copy>Loading ride details…</Copy>
          )}
        </Screen>
      ) : (
        <SupportForm
          key={general ? 'general' : 'ride'}
          list={list}
          submit={(input, key) => api.createSupportRequest(input, key)}
          newKey={Crypto.randomUUID}
          initialDraft={
            verified && !general
              ? {
                  category: category === 'payment' ? 'payment' : 'trip',
                  message: `Ride reference: ${rideId}\n\n`,
                }
              : undefined
          }
        />
      )}
    </>
  );
}
