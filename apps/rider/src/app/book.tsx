import { useEffect, useRef, useState } from 'react';
import { createLatestRequest } from '@rove/mobile-core/latest-request';
import { useOperations } from '@rove/mobile-core/use-operations';
import { router, Stack } from 'expo-router';
import { ServicePicker, serviceLabels } from '../booking/service-picker';
import type { Place, Quote } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, Field, Money, RouteSummary, Screen } from '@rove/mobile-ui';
export default function Book() {
  const { profile } = useSession();
  return <BookingForm key={profile?.id ?? 'signed-out'} />;
}
function BookingForm() {
  const { api, profile, synthetic } = useSession();
  const { pending, restoring, recoveryError, execute } = useOperations();
  const [service, setService] = useState<Quote['service']>('standard');
  const [pickup, setPickup] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [target, setTarget] = useState<'pickup' | 'destination'>('pickup');
  const [query, setQuery] = useState('');
  const requests = useRef(createLatestRequest());
  const mounted = useRef(true);
  const submitting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = requests.current;
    return () => {
      mounted.current = false;
      controller.cancel();
    };
  }, []);
  const [searched, setSearched] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(quoteId: string) {
    const ride = await execute({ kind: 'book', quoteId });
    if (!mounted.current) return;
    router.replace({ pathname: synthetic ? '/ride' : '/payment', params: { id: ride.id } });
  }
  async function perform(work: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'Please try again.');
    } finally {
      submitting.current = false;
      if (mounted.current) setLoading(false);
    }
  }
  function cancelRead() {
    requests.current.cancel();
    setLoading(false);
    setPlaces([]);
    setSearched(false);
    setError(null);
  }
  function edit(next: 'pickup' | 'destination', text = '') {
    cancelRead();
    setQuote(null);
    setTarget(next);
    if (next === 'pickup') setPickup(null);
    else setDestination(null);
    setQuery(text);
  }
  async function read<T>(load: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void) {
    setLoading(true);
    setError(null);
    await requests.current.run(load, {
      data: apply,
      error: (failure) => setError(failure instanceof Error ? failure.message : 'Please try again.'),
      settled: () => setLoading(false),
    });
  }

  if (!profile)
    return (
      <Screen>
        <Copy kind="heading">Sign in to book a ride.</Copy>
        <Button title="Back to sign in" onPress={() => router.replace('/')} />
      </Screen>
    );
  if (restoring)
    return (
      <Screen>
        <Copy>Checking your previous request…</Copy>
      </Screen>
    );
  if (recoveryError)
    return (
      <Screen>
        <Banner error message={recoveryError} />
      </Screen>
    );
  if (pending)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Confirm previous request' }} />
        <Copy kind="title">Let’s confirm your request.</Copy>
        <Copy>We saved your previous action. Check its result before starting another ride.</Copy>
        {error && <Banner error message={error} />}
        {pending.operation.kind === 'book' ? (
          <Button
            title="Check booking result"
            loading={loading}
            onPress={() => {
              const operation = pending.operation;
              if (operation.kind === 'book') void perform(() => submit(operation.quoteId));
            }}
          />
        ) : (
          <Button
            title="Return to your trip"
            onPress={() => {
              const operation = pending.operation;
              if (operation.kind === 'transition')
                router.replace({ pathname: '/ride', params: { id: operation.rideId } });
            }}
          />
        )}
      </Screen>
    );
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Book a ride' }} />
      <Copy kind="title">{quote ? 'Confirm your ride.' : 'Your route.'}</Copy>
      {error && <Banner error message={error} />}
      {quote ? (
        <>
          <RouteSummary pickup={quote.pickup.label} destination={quote.destination.label} />
          <Card>
            <Copy kind="heading">{serviceLabels[quote.service]}</Copy>
            <Money cents={quote.fare.amount} label="YOUR FARE" />
            <Copy kind="muted">
              {Math.ceil(quote.durationSeconds / 60)} min · {(quote.distanceMeters / 1000).toFixed(1)} km
            </Copy>
            <Copy kind="muted">
              A quote does not reserve a driver. You’ll see the matching status after requesting.
            </Copy>
          </Card>
          <Button
            title="Request ride"
            loading={loading}
            onPress={() =>
              void perform(async () => {
                if (Date.parse(quote.expiresAt) <= Date.now()) {
                  setQuote(null);
                  throw new Error('This quote expired. Review an updated fare before requesting.');
                }
                await submit(quote.id);
              })
            }
          />
          <Button
            title="Change route or service"
            variant="secondary"
            disabled={loading}
            onPress={() => setQuote(null)}
          />
        </>
      ) : (
        <>
          {pickup && (
            <Card>
              <Copy kind="label">PICKUP</Copy>
              <Copy>{pickup.label}</Copy>
              <Button
                title="Change pickup"
                variant="secondary"
                onPress={() => {
                  edit('pickup');
                }}
              />
            </Card>
          )}
          {destination && (
            <Card>
              <Copy kind="label">DESTINATION</Copy>
              <Copy>{destination.label}</Copy>
              <Button
                title="Change destination"
                variant="secondary"
                onPress={() => {
                  edit('destination');
                }}
              />
            </Card>
          )}
          {(!pickup || !destination) && (
            <>
              <Field
                label={target === 'pickup' ? 'Pickup address' : 'Destination address'}
                value={query}
                onChangeText={(text) => edit(target, text)}
                placeholder="Search an address or place"
                autoCorrect={false}
              />
              <Button
                title="Search places"
                disabled={query.trim().length < 3}
                loading={loading}
                onPress={() =>
                  void read(
                    (signal) => api.places(query.trim(), signal),
                    (result) => {
                      setPlaces(result.places);
                      setSearched(true);
                    },
                  )
                }
              />
            </>
          )}
          {searched && !loading && places.length === 0 && (
            <Copy kind="muted">No places found. Try a different address.</Copy>
          )}
          {places.map((place) => (
            <Button
              key={place.id}
              title={place.label}
              variant="secondary"
              onPress={() => {
                cancelRead();
                if (target === 'pickup') {
                  setPickup(place);
                  setTarget('destination');
                } else setDestination(place);
                setPlaces([]);
                setQuery('');
              }}
            />
          ))}
          {pickup && destination && (
            <ServicePicker
              value={service}
              onChange={(next) => {
                cancelRead();
                setQuote(null);
                setService(next);
              }}
            />
          )}
          {pickup && destination && (
            <Button
              title="See your fare"
              loading={loading}
              onPress={() => void read((signal) => api.quote(pickup, destination, service, signal), setQuote)}
            />
          )}
        </>
      )}
    </Screen>
  );
}
