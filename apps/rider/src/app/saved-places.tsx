import { useEffect, useRef, useState } from 'react';
import { router, Stack } from 'expo-router';
import { Keyboard } from 'react-native';
import type { Place } from '@rove/contracts';
import { createLatestRequest } from '@rove/mobile-core/latest-request';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Copy, Field, Screen } from '@rove/mobile-ui';
import { SavedPlaceControls } from '../booking/saved-places';

export default function SavedPlaces() {
  const { profile } = useSession();
  if (!profile)
    return (
      <Screen>
        <Copy>Sign in to manage saved places.</Copy>
        <Button title="Back to sign in" onPress={() => router.replace('/')} />
      </Screen>
    );
  return <SavedPlacesForm key={profile.id} />;
}

function SavedPlacesForm() {
  const { api } = useSession();
  const requests = useRef(createLatestRequest());
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const current = requests.current;
    return () => current.cancel();
  }, []);
  function edit(text: string) {
    requests.current.cancel();
    setQuery(text);
    setSelected(null);
    setPlaces([]);
    setLoading(false);
    setSearched(false);
    setError(null);
  }
  async function search() {
    Keyboard.dismiss();
    setLoading(true);
    setError(null);
    await requests.current.run((signal) => api.places(query.trim(), signal), {
      data: ({ places: results }) => {
        setPlaces(results);
        setSearched(true);
      },
      error: () => setError('Places could not be loaded. Please try again.'),
      settled: () => setLoading(false),
    });
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Saved places' }} />
      <Copy kind="title">Your familiar places.</Copy>
      <Copy kind="muted">
        Search for an address, then save it as Home or Work. You can replace or remove either at any time.
      </Copy>
      <Field
        label="Saved place address"
        testID="saved-place-address"
        value={query}
        onChangeText={edit}
        placeholder="Search an address or place"
        autoCorrect={false}
      />
      <Button
        title="Search places"
        disabled={query.trim().length < 3}
        loading={loading}
        onPress={() => void search()}
      />
      {error && <Banner error message={error} />}
      {searched && !loading && places.length === 0 && (
        <Copy kind="muted">No places found. Try a different address.</Copy>
      )}
      {places.map((place) => (
        <Button
          key={place.id}
          title={place.label}
          variant="secondary"
          onPress={() => {
            Keyboard.dismiss();
            requests.current.cancel();
            setSelected(place);
            setPlaces([]);
            setSearched(false);
            setLoading(false);
          }}
        />
      ))}
      {selected && <Copy>Selected: {selected.label}</Copy>}
      <SavedPlaceControls api={api} selected={selected} busy={loading} management />
    </Screen>
  );
}
