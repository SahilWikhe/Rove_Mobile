import { useCallback, useRef, useState } from 'react';
import { Stack, router, useFocusEffect } from 'expo-router';
import type { DriverProfile, DriverPayoutStatus, VehicleReview } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, Screen } from '@rove/mobile-ui';
import { VehicleReviewStatus } from '../vehicle/review-status';

type Status = { driver: DriverProfile; vehicle: VehicleReview | null; payout: DriverPayoutStatus['status'] };
export default function Setup() {
  const { profile } = useSession();
  return <SetupStatus key={profile?.id ?? 'signed-out'} />;
}
function SetupStatus() {
  const { profile, api, synthetic } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  useFocusEffect(
    useCallback(() => {
      void revision;
      const generation = ++epoch.current;
      const abort = new AbortController();
      setStatus(null);
      setError(null);
      if (profile)
        void Promise.all([
          api.driverProfile(abort.signal),
          api.vehicleSubmission(),
          api.driverPayoutStatus(abort.signal),
        ])
          .then(([driver, vehicle, payout]) => {
            if (epoch.current === generation)
              setStatus({ driver, vehicle: vehicle.submission, payout: payout.status });
          })
          .catch(() => {
            if (epoch.current === generation)
              setError('Unable to check your setup. Retry to see the latest status.');
          });
      return () => {
        epoch.current++;
        abort.abort();
      };
    }, [api, profile, revision]),
  );
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Driver setup' }} />
      <Copy kind="title">Your road to ready.</Copy>
      {!profile ? (
        <Button title="Sign in" onPress={() => router.replace('/')} />
      ) : (
        <>
          {synthetic && (
            <Banner message="Synthetic preview. Setup statuses are test data, not approval to drive real trips." />
          )}
          <Copy>
            Check your progress and take the next step. Rove verifies your eligibility before you can go
            online.
          </Copy>
          {error && <Banner error message={error} />}
          {!status && !error && <Copy>Checking your setup…</Copy>}
          {status && (
            <>
              <Card>
                <Copy kind="heading">Driving eligibility</Copy>
                <Copy>
                  {status.driver.eligible
                    ? 'Your account is currently eligible.'
                    : status.driver.approved
                      ? 'Your account needs an eligibility check.'
                      : 'Your account review is not complete.'}
                </Copy>
                <Copy kind="muted">
                  Vehicle review and payout setup are separate checks. Location permission is requested when
                  you go online.
                </Copy>
                <Button
                  title={status.driver.eligible ? 'Back to Drive' : 'Get help with eligibility'}
                  variant="secondary"
                  onPress={() => router.push(status.driver.eligible ? '/drive' : '/support')}
                />
              </Card>
              <VehicleReviewStatus submission={status.vehicle} />
              <Button
                title={status.vehicle ? 'Review vehicle details' : 'Add your vehicle'}
                variant="secondary"
                onPress={() => router.push('/vehicle')}
              />
              <Card>
                <Copy kind="heading">Payout details</Copy>
                <Copy>
                  {
                    {
                      unavailable: 'Payout setup is not available yet.',
                      not_started: 'Add your payout details.',
                      pending: 'Stripe is reviewing your details.',
                      needs_information: 'Stripe needs more information.',
                      ready: 'Stripe details are ready.',
                    }[status.payout]
                  }
                </Copy>
                <Copy kind="muted">
                  A ready Stripe account does not by itself confirm driving approval or that a payout has been
                  sent.
                </Copy>
                <Button
                  title="View payout setup"
                  variant="secondary"
                  onPress={() => router.push('/payouts')}
                />
              </Card>
            </>
          )}
          <Button
            title="Refresh setup status"
            variant="secondary"
            onPress={() => setRevision((value) => value + 1)}
          />
        </>
      )}
    </Screen>
  );
}
