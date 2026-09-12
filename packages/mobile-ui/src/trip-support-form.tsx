import { useEffect, useState, type ComponentProps } from 'react';
import { RideSummary } from '@rove/contracts';
import { Banner, Button, Copy, Screen } from './index';
import { SupportForm } from './support-form';

/** Mount per account and route reference; unverified references never enter a support request. */
export function TripSupportForm({
  signedIn: profile,
  rideId,
  category,
  loadRide,
  list,
  submit,
  newKey,
}: Pick<ComponentProps<typeof SupportForm>, 'list' | 'submit' | 'newKey'> & {
  signedIn: boolean;
  rideId?: string | undefined;
  category?: string | undefined;
  loadRide: (id: string, signal: AbortSignal) => Promise<{ id: string }>;
}) {
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
    void loadRide(rideId, controller.signal)
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
  }, [loadRide, rideId, profile, general, retry]);
  return (
    <>
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
          submit={submit}
          newKey={newKey}
          {...(verified && !general
            ? {
                initialDraft: {
                  category: category === 'payment' ? 'payment' : 'trip',
                  message: `Ride reference: ${rideId}`,
                },
              }
            : {})}
        />
      )}
    </>
  );
}
