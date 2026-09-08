import { useState } from 'react';
import { useOperations } from '@rove/mobile-core/use-operations';
import { router, Stack } from 'expo-router';
import type { Place, Quote } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, Field, Money, RouteSummary, Screen } from '@rove/mobile-ui';
export default function Book() {
  const { api, profile } = useSession();
  const { pending, restoring, recoveryError, execute } = useOperations();
  const [pickup, setPickup] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [target, setTarget] = useState<'pickup' | 'destination'>('pickup');
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(quoteId: string) {
    const ride = await execute({ kind: 'book', quoteId });
    router.replace({ pathname: '/ride', params: { id: ride.id } });
  }
  async function perform(work: () => Promise<void>) {
    setLoading(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
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
      <Copy kind="title">Your route.</Copy>
      {error && <Banner error message={error} />}
      {quote ? (
        <>
          <RouteSummary pickup={quote.pickup.label} destination={quote.destination.label} />
          <Card>
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
            title="Change route"
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
                  setTarget('pickup');
                  setQuery('');
                  setPlaces([]);
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
                  setTarget('destination');
                  setQuery('');
                  setPlaces([]);
                }}
              />
            </Card>
          )}
          <Field
            label={target === 'pickup' ? 'Pickup address' : 'Destination address'}
            value={query}
            onChangeText={setQuery}
            placeholder="Search an address or place"
            autoCorrect={false}
          />
          <Button
            title="Search places"
            disabled={query.trim().length < 3}
            loading={loading}
            onPress={() => void perform(async () => setPlaces((await api.places(query.trim())).places))}
          />
          {places.map((place) => (
            <Button
              key={place.id}
              title={place.label}
              variant="secondary"
              onPress={() => {
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
            <Button
              title="See your fare"
              loading={loading}
              onPress={() =>
                void perform(async () => {
                  setQuote(await api.quote(pickup, destination, 'standard'));
                })
              }
            />
          )}
        </>
      )}
    </Screen>
  );
}
