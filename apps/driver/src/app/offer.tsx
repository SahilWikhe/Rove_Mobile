import { useOperations } from '@rove/mobile-core/use-operations';
import { useTrackingError } from '../tracking/provider';
import { useCallback, useRef, useState } from 'react';
import { router, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as Crypto from 'expo-crypto';
import type { DriverOffer } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Copy, Screen } from '@rove/mobile-ui';
import { DriveSurface } from '../home/drive-surface';
import { OfferSummary } from '../offers/offer-summary';
export default function Offer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useSession();
  return <OfferContent key={`${profile?.id ?? 'signed-out'}:${id}`} id={id} />;
}
function OfferContent({ id }: { id: string }) {
  const { api, synthetic } = useSession();
  const { pending, restoring, recoveryError, execute } = useOperations();
  const epoch = useRef(0);
  const sending = useRef(false);
  const trackingError = useTrackingError();
  const [offer, setOffer] = useState<DriverOffer | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = useRef({ decline: Crypto.randomUUID() });
  useFocusEffect(
    useCallback(() => {
      let stopped = false;
      epoch.current++;
      const abort = new AbortController();
      void api
        .offers(abort.signal)
        .then((result) => {
          if (!stopped) {
            setOffer(result.offers.find((item) => item.id === id) ?? null);
            if (!result.offers.some((item) => item.id === id))
              setError('This request is no longer available.');
          }
        })
        .catch((failure) => {
          if (!stopped) setError(failure.message);
        });
      const timer = setInterval(() => setNow(Date.now()), 1000);
      return () => {
        stopped = true;
        epoch.current++;
        abort.abort();
        clearInterval(timer);
      };
    }, [api, id]),
  );
  const remaining = offer ? Math.max(0, Math.ceil((Date.parse(offer.expiresAt) - now) / 1000)) : 0;
  async function respond(accept: boolean) {
    if (sending.current || restoring || recoveryError) return;
    sending.current = true;
    const generation = epoch.current;
    setBusy(true);
    setError(null);
    try {
      if (accept) {
        const ride = await execute({ kind: 'accept', offerId: id });
        if (generation !== epoch.current) return;
        router.replace({ pathname: '/trip', params: { id: ride.id } });
      } else {
        await api.decline(id, keys.current.decline);
        if (generation !== epoch.current) return;
        router.replace('/drive');
      }
    } catch (failure) {
      if (generation === epoch.current)
        setError(failure instanceof Error ? failure.message : 'Offer response could not be confirmed.');
    } finally {
      sending.current = false;
      if (generation === epoch.current) setBusy(false);
    }
  }
  if (restoring || recoveryError || pending)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Confirm previous request' }} />
        {recoveryError ? (
          <Banner error message={recoveryError} />
        ) : restoring ? (
          <Copy>Checking previous requests…</Copy>
        ) : (
          <>
            <Copy kind="heading">Confirm your previous request.</Copy>
            <Copy>
              Your original acceptance request is saved. Check its result before responding to another offer.
            </Copy>
            {error && <Banner error message={error} />}
            {pending?.operation.kind === 'accept' && pending.operation.offerId === id ? (
              <Button title="Check acceptance result" loading={busy} onPress={() => void respond(true)} />
            ) : (
              <Button title="Return to driving" onPress={() => router.replace('/drive')} />
            )}
          </>
        )}
      </Screen>
    );
  return (
    <DriveSurface online={Boolean(offer)} synthetic={synthetic} request>
      <Stack.Screen options={{ headerShown: false }} />
      {error && <Banner error message={error} />}
      {trackingError && <Banner error message={trackingError} />}
      {offer ? (
        <>
          <OfferSummary offer={offer} remaining={remaining} />
          <Button
            title="Accept ride"
            style={{ borderRadius: 27 }}
            disabled={!remaining}
            loading={busy}
            onPress={() => void respond(true)}
          />
          <Button
            title="Decline"
            style={{ borderRadius: 25 }}
            variant="secondary"
            disabled={!remaining || busy}
            onPress={() => void respond(false)}
          />
        </>
      ) : (
        !error && <Copy kind="muted">Loading the request…</Copy>
      )}
      <Button title="Back to driving" variant="secondary" onPress={() => router.replace('/drive')} />
    </DriveSurface>
  );
}
