import { useEffect, useState } from 'react';
import type { Coordinate, Quote } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { TripMap } from '@rove/mobile-ui/trip-map';
import { Banner, Button, Copy } from '@rove/mobile-ui';

export function RoutePreview({ quote }: { quote: Quote }) {
  const { api, synthetic } = useSession();
  const [route, setRoute] = useState<Coordinate[] | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setError(null);
    setRoute(undefined);
    void api
      .quoteRoute(quote.id, controller.signal)
      .then((result) => {
        if (current) setRoute(result.coordinates);
      })
      .catch(() => {
        if (current)
          setError('The road route could not be loaded. Your pickup, destination and fare remain below.');
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [api, quote.id, attempt]);
  return (
    <>
      <TripMap
        key={`${quote.id}:${route ? attempt + 1 : 0}`}
        pickup={quote.pickup.coordinate}
        destination={quote.destination.coordinate}
        route={route}
        height={300}
        synthetic={synthetic}
        androidEnabled={!!process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY}
        iosEnabled={!!process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY}
      />
      {!route && !error && <Copy kind="muted">Loading your road route…</Copy>}
      {error && (
        <>
          <Banner message={error} />
          <Button
            title="Retry route preview"
            variant="secondary"
            onPress={() => setAttempt((value) => value + 1)}
          />
        </>
      )}
      <Copy kind="muted">
        Check your pickup address before requesting. The route is a preview and may change.
      </Copy>
    </>
  );
}
