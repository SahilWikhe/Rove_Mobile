import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { useSession } from '@rove/mobile-core/session';
import { Button, Copy } from '@rove/mobile-ui';
import type { Place } from '@rove/contracts';
import { PlaceResult } from './route-entry';

export function NearbyPlaces({ visible, onSelect }: { visible: boolean; onSelect: (place: Place) => void }) {
  const { api, synthetic } = useSession();
  const [places, setPlaces] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Allow location to see places near you, or enter an address above.');
  const [attempt, setAttempt] = useState(0);
  const requesting = useRef(false);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    requesting.current = true;
    setBusy(true);
    async function load() {
      if (!synthetic) {
        const permission =
          attempt > 0
            ? await Location.requestForegroundPermissionsAsync()
            : await Location.getForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          if (current) setMessage('Allow location to see places near you, or enter an address above.');
          return;
        }
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      let coordinate;
      try {
        const position = synthetic
          ? null
          : await Promise.race([
              Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error('Location took too long. Try again or enter an address.')),
                  15000,
                );
              }),
            ]);
        if (!current) return;
        coordinate = position
          ? { latitude: position.coords.latitude, longitude: position.coords.longitude }
          : { latitude: 35.7796, longitude: -78.6382 };
      } finally {
        if (timer) clearTimeout(timer);
      }
      const result = await api.nearbyPlaces(coordinate, controller.signal);
      if (current) {
        setPlaces(result.places);
        setMessage(result.places.length ? '' : 'No nearby places found. Enter a place or address above.');
      }
    }
    void load()
      .catch((failure) => {
        if (current)
          setMessage(
            failure instanceof Error
              ? failure.message
              : 'Nearby places are unavailable. Enter an address above.',
          );
      })
      .finally(() => {
        if (current) {
          setBusy(false);
          requesting.current = false;
        }
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [api, synthetic, attempt]);
  if (!visible) return null;
  return (
    <>
      <Copy kind="label">{synthetic ? 'Suggested places' : 'Places near you'}</Copy>
      {busy ? (
        <Copy kind="muted">Finding nearby places…</Copy>
      ) : (
        <>
          {message ? <Copy kind="muted">{message}</Copy> : null}
          {places.map((place) => (
            <PlaceResult key={place.id} place={place} onPress={() => onSelect(place)} />
          ))}
          {!places.length && (
            <Button
              title="Suggest places around me"
              variant="secondary"
              onPress={() => {
                if (requesting.current) return;
                requesting.current = true;
                setAttempt((value) => value + 1);
              }}
            />
          )}
        </>
      )}
      {!synthetic && places.length > 0 && <Copy kind="muted">Google Maps</Copy>}
    </>
  );
}
