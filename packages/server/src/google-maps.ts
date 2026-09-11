import { z } from 'zod';
import { Coordinate, Place } from '@rove/contracts';
import { DomainError } from './errors';
import type { MapsProvider, ServiceArea } from './quotes';

/** Internal diagnostic only; public API handlers expose the unchanged DomainError fields. */
export class MapsProviderUnavailable extends DomainError {
  constructor(readonly upstreamStatus?: number) {
    super('MAPS_UNAVAILABLE', 'Maps are temporarily unavailable. Please try again.', 503);
  }
}

type Transport = (url: string, options: RequestInit) => Promise<Response>;
const GooglePlace = z.object({
  id: z.string(),
  formattedAddress: z.string(),
  location: Coordinate,
  displayName: z.object({ text: z.string() }).optional(),
  addressComponents: z.array(z.object({ longText: z.string(), types: z.array(z.string()) })).optional(),
});
const fields = 'id,displayName,formattedAddress,location,addressComponents';
function placeFromGoogle(value: z.infer<typeof GooglePlace>): Place {
  // Coarse area must never fall back to a street, business, hospital or exact address.
  const components = value.addressComponents ?? [];
  const area =
    components.find((component) => component.types.includes('locality'))?.longText ??
    components.find((component) => component.types.includes('administrative_area_level_2'))?.longText ??
    'Local area';
  const name = value.displayName?.text;
  return Place.parse({
    id: value.id,
    label: (name ? `${name} · ${value.formattedAddress}` : value.formattedAddress).slice(0, 200),
    area: area.slice(0, 100),
    coordinate: value.location,
  });
}
export class GoogleMapsProvider implements MapsProvider {
  constructor(
    private apiKey: string,
    private area: ServiceArea,
    private transport: Transport = (url, options) => fetch(url, options),
  ) {
    if (!apiKey.trim()) throw new Error('A server Google Maps API key is required.');
  }
  private async call(url: string, fieldMask: string, body?: unknown): Promise<unknown> {
    try {
      const response = await this.transport(url, {
        method: body === undefined ? 'GET' : 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': fieldMask,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new MapsProviderUnavailable(response.status);
      return await response.json();
    } catch (error) {
      if (error instanceof MapsProviderUnavailable) throw error;
      throw new MapsProviderUnavailable();
    }
  }
  async search(query: string): Promise<Place[]> {
    if (query.trim().length < 3 || query.length > 150)
      throw new DomainError('INVALID_QUERY', 'Enter a place or address.', 400);
    const result = await this.call(
      'https://places.googleapis.com/v1/places:searchText',
      fields
        .split(',')
        .map((field) => `places.${field}`)
        .join(','),
      {
        textQuery: query.trim(),
        pageSize: 5,
        languageCode: 'en',
        regionCode: 'US',
        locationBias: {
          rectangle: {
            low: { latitude: this.area.south, longitude: this.area.west },
            high: { latitude: this.area.north, longitude: this.area.east },
          },
        },
      },
    );
    const parsed = z.object({ places: z.array(z.unknown()).optional() }).safeParse(result);
    if (!parsed.success)
      throw new DomainError('MAPS_UNAVAILABLE', 'Place search is temporarily unavailable.', 503);
    return (parsed.data.places ?? []).flatMap((value) => {
      const place = GooglePlace.safeParse(value);
      return place.success ? [placeFromGoogle(place.data)] : [];
    });
  }
  async resolve(id: string): Promise<Place> {
    if (!/^[A-Za-z0-9_-]{3,200}$/.test(id))
      throw new DomainError('INVALID_PLACE', 'Select a place from search.', 400);
    const value = GooglePlace.safeParse(
      await this.call(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, fields),
    );
    if (!value.success || value.data.id !== id)
      throw new DomainError('PLACE_UNAVAILABLE', 'This place could not be verified. Search again.', 422);
    return placeFromGoogle(value.data);
  }
  async route(pickup: Place, destination: Place) {
    Coordinate.parse(pickup.coordinate);
    Coordinate.parse(destination.coordinate);
    const result = await this.call(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      'routes.distanceMeters,routes.duration',
      {
        origin: { location: { latLng: pickup.coordinate } },
        destination: { location: { latLng: destination.coordinate } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        computeAlternativeRoutes: false,
        routeModifiers: { avoidTolls: true, avoidFerries: true },
        languageCode: 'en-US',
        units: 'METRIC',
      },
    );
    const parsed = z
      .object({
        routes: z
          .array(
            z.object({
              distanceMeters: z.number().int().nonnegative().max(10_000_000),
              duration: z.string().regex(/^\d+(\.\d{1,9})?s$/),
            }),
          )
          .optional(),
      })
      .safeParse(result);
    if (!parsed.success)
      throw new DomainError('MAPS_UNAVAILABLE', 'The route estimate is temporarily unavailable.', 503);
    const route = parsed.data.routes?.[0];
    if (!route) throw new DomainError('NO_ROUTE', 'No driving route was found between these places.', 422);
    const durationSeconds = Math.ceil(Number(route.duration.slice(0, -1)));
    if (!Number.isSafeInteger(durationSeconds) || durationSeconds > 10_000_000)
      throw new DomainError('MAPS_UNAVAILABLE', 'The route estimate is temporarily unavailable.', 503);
    return { distanceMeters: route.distanceMeters, durationSeconds };
  }
}
