import { useRef, useState } from 'react';
import { router, Stack } from 'expo-router';
import * as Crypto from 'expo-crypto';
import type { Place, Quote } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, Field, Money, RouteSummary, Screen } from '@rove/mobile-ui';
export default function Book() {
  const { api, profile } = useSession();
  const [pickup, setPickup] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [target, setTarget] = useState<'pickup' | 'destination'>('pickup');
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
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
                  key.current = null;
                  throw new Error('This quote expired. Review an updated fare before requesting.');
                }
                key.current ??= Crypto.randomUUID();
                const ride = await api.book(quote.id, key.current);
                router.replace({ pathname: '/ride', params: { id: ride.id } });
              })
            }
          />
          <Button
            title="Change route"
            variant="secondary"
            disabled={loading || key.current !== null}
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
                  key.current = null;
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
