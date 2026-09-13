import { TrackingRecovery } from '../tracking/recovery';
import { DriveSurface } from '../home/drive-surface';
import { DriveEarnings } from '../home/drive-earnings';
import { DriveHeader } from '../home/drive-header';
import { DriverNavigation } from '../navigation/driver-navigation';
import { useOperations } from '@rove/mobile-core/use-operations';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { currentPosition, useTrackingError } from '../tracking/provider';
import { useCallback, useState } from 'react';
import { Stack, router, useFocusEffect } from 'expo-router';
import {
  requestTrackingPermissions,
  unblockTracking,
  synchronizeBackgroundTracking,
  stopBackgroundTracking,
} from '../tracking/background';
import * as Crypto from 'expo-crypto';
import type { DriverProfile, DriverOffer, RideDetails } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy } from '@rove/mobile-ui';
export default function Drive() {
  const { api, synthetic, profile: account } = useSession();
  const { pending, recoveryError, refresh: refreshOperations } = useOperations();
  useFocusEffect(
    useCallback(() => {
      void refreshOperations();
    }, [refreshOperations]),
  );
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [offer, setOffer] = useState<DriverOffer | null>(null);
  const [active, setActive] = useState<RideDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trackingError = useTrackingError();
  const [explainLocation, setExplainLocation] = useState(false);
  useFocusEffect(
    useCallback(
      () =>
        pollWhileForeground({
          load: (signal) =>
            Promise.all([api.driverProfile(signal), api.offers(signal), api.rides(undefined, signal)]),
          onData: ([driver, offered, history]) => {
            setProfile(driver);
            setOffer(offered.offers[0] ?? null);
            setActive(
              history.rides.find((ride) =>
                ['matched', 'en_route', 'arrived', 'in_progress', 'interrupted'].includes(ride.state),
              ) ?? null,
            );
            setReadError(null);
          },
          onError: (failure) =>
            setReadError(failure instanceof Error ? failure.message : 'Connection unavailable.'),
          intervalMs: 3000,
        }),
      [api],
    ),
  );
  async function availability(confirmed = false) {
    if (!profile) return;
    if (!profile.online && !synthetic && !confirmed) {
      setExplainLocation(true);
      return;
    }
    setExplainLocation(false);
    setBusy(true);
    setError(null);
    try {
      if (!profile.online && !synthetic) await requestTrackingPermissions();
      const sample = profile.online ? undefined : await currentPosition(synthetic);
      await api.availability(!profile.online, sample?.coordinate, Crypto.randomUUID());
      const updated = await api.driverProfile();
      setProfile(updated);
      if (!synthetic && account) {
        if (updated.online) {
          await unblockTracking();
          await synchronizeBackgroundTracking(api, account.id);
        } else await stopBackgroundTracking();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Availability could not be updated.');
    } finally {
      setBusy(false);
    }
  }
  const waiting = Boolean(profile?.online && !active && !offer);
  return (
    <DriveSurface
      online={waiting}
      synthetic={synthetic}
      footer={<DriverNavigation active="/drive" disabled={busy} />}
    >
      <Stack.Screen options={{ headerShown: false }} />
      {!waiting && (
        <DriveHeader
          name={account?.name ?? ''}
          online={profile?.online ?? null}
          activeTrip={Boolean(active)}
        />
      )}
      {account && <DriveEarnings key={account.id} />}
      {(error || readError) && <Banner error message={error ?? readError!} />}
      {trackingError && <TrackingRecovery message={trackingError} disabled={busy} />}
      {waiting ? (
        <Copy kind="muted" style={{ textAlign: 'center', fontSize: 12 }}>
          Waiting for a request…
        </Copy>
      ) : (
        <Card style={{ minHeight: 140, borderRadius: 18, justifyContent: 'center', alignItems: 'center' }}>
          <Copy kind="heading">
            {active
              ? 'Your trip is active'
              : offer
                ? 'A new ride request'
                : profile?.online
                  ? 'Looking for your next trip'
                  : 'You’re offline'}
          </Copy>
          <Copy kind="muted">
            {profile?.online
              ? 'Keep your location available for matching.'
              : 'Go online when you’re ready to drive.'}
          </Copy>
        </Card>
      )}
      {active ? (
        <Button
          title="Continue your trip"
          onPress={() => router.push({ pathname: '/trip', params: { id: active.id } })}
        />
      ) : offer ? (
        <Button
          title="View ride request"
          onPress={() => router.push({ pathname: '/offer', params: { id: offer.id } })}
        />
      ) : null}
      {explainLocation && (
        <Card>
          <Copy kind="heading">Keep your ride connected.</Copy>
          <Copy>
            Rove needs precise location while you’re online, including when the phone is locked or you’re
            using navigation. Go offline to stop sharing. On the next screen, choose Always / Allow all the
            time.
          </Copy>
          <Button title="Continue with location" loading={busy} onPress={() => void availability(true)} />
          <Button title="Not now" variant="secondary" onPress={() => setExplainLocation(false)} />
        </Card>
      )}
      {profile && !profile.eligible && (
        <>
          <Banner message="Complete your document review and payout setup before going online." />
          <Button title="View setup progress" variant="secondary" onPress={() => router.push('/setup')} />
        </>
      )}
      {recoveryError && <Banner error message={recoveryError} />}
      {pending?.operation.kind === 'accept' && (
        <Button
          title="Check previous acceptance"
          variant="secondary"
          onPress={() => {
            if (pending.operation.kind === 'accept')
              router.push({ pathname: '/offer', params: { id: pending.operation.offerId } });
          }}
        />
      )}
      <Button
        title={profile?.online ? 'Go offline' : 'Go online'}
        variant={profile?.online ? 'secondary' : 'gold'}
        style={{ borderRadius: 28, minHeight: 56 }}
        disabled={!profile || (!profile.online && !profile.eligible) || Boolean(active)}
        loading={busy}
        onPress={() => void availability()}
      />
    </DriveSurface>
  );
}
