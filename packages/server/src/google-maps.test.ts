import { expect, test, vi } from 'vitest';
import { GoogleMapsProvider } from './google-maps';
const area = { south: 35, north: 37, west: -80, east: -77 };
const fixture = {
  id: 'google-fixture-id',
  formattedAddress: 'Private street address',
  displayName: { text: 'Private business' },
  location: { latitude: 35.8, longitude: -78.6 },
  addressComponents: [
    { longText: 'Private street', types: ['route'] },
    { longText: 'Raleigh', types: ['locality'] },
  ],
};
test('search sends a bounded field mask and uses only coarse address components in offers', async () => {
  const transport = vi.fn(
    async (_url: string, _options: RequestInit) => new Response(JSON.stringify({ places: [fixture] })),
  );
  const maps = new GoogleMapsProvider('fixture-key', area, transport);
  const places = await maps.search('Home');
  expect(places[0]?.area).toBe('Raleigh');
  const [url, options] = transport.mock.calls[0]!;
  expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
  expect(url).not.toContain('fixture-key');
  expect(options.headers).toMatchObject({ 'X-Goog-Api-Key': 'fixture-key' });
  expect(JSON.parse(String(options.body)).pageSize).toBe(5);
  const withoutCity = new GoogleMapsProvider(
    'key',
    area,
    async () =>
      new Response(
        JSON.stringify({
          places: [{ ...fixture, addressComponents: [{ longText: 'Private street', types: ['route'] }] }],
        }),
      ),
  );
  expect((await withoutCity.search('Home'))[0]?.area).toBe('Local area');
});
test('resolution rejects URL injection and mismatched provider identities', async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify(fixture)));
  const maps = new GoogleMapsProvider('key', area, transport);
  await expect(maps.resolve('https://attacker.example')).rejects.toMatchObject({ code: 'INVALID_PLACE' });
  expect(transport).not.toHaveBeenCalled();
  await expect(maps.resolve('different-id')).rejects.toMatchObject({ code: 'PLACE_UNAVAILABLE' });
});
test('driving estimate uses trusted endpoints and rounds provider seconds without inventing a route', async () => {
  const place = {
    id: fixture.id,
    label: fixture.formattedAddress,
    area: 'Raleigh',
    coordinate: fixture.location,
  };
  const transport = vi.fn(
    async (_url: string, _options: RequestInit) =>
      new Response(JSON.stringify({ routes: [{ distanceMeters: 1234, duration: '180.25s' }] })),
  );
  expect(await new GoogleMapsProvider('key', area, transport).route(place, place)).toEqual({
    distanceMeters: 1234,
    durationSeconds: 181,
  });
  expect(JSON.parse(String(transport.mock.calls[0]![1].body))).toMatchObject({
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    origin: { location: { latLng: fixture.location } },
  });
  await expect(
    new GoogleMapsProvider('key', area, async () => new Response('{}')).route(place, place),
  ).rejects.toMatchObject({ code: 'NO_ROUTE' });
});
test('provider errors are safe and never echo credentials or private routes', async () => {
  const maps = new GoogleMapsProvider(
    'secret-fixture',
    area,
    async () => new Response('secret-fixture Private address', { status: 403 }),
  );
  await expect(maps.search('Home')).rejects.toMatchObject({ code: 'MAPS_UNAVAILABLE', status: 503 });
  try {
    await maps.search('Home');
  } catch (error) {
    expect(String(error)).not.toContain('secret-fixture');
    expect(String(error)).not.toContain('Private address');
  }
});

test.each([400, 401, 403, 429, 500, 503])(
  'preserves safe upstream HTTP %i without response contents',
  async (status) => {
    const maps = new GoogleMapsProvider(
      'synthetic-secret',
      area,
      async () =>
        new Response(
          JSON.stringify({
            error: { message: 'synthetic-secret private address', details: ['private-project'] },
          }),
          { status },
        ),
    );
    await expect(maps.search('Public station')).rejects.toMatchObject({
      code: 'MAPS_UNAVAILABLE',
      status: 503,
      upstreamStatus: status,
      message: 'Maps are temporarily unavailable. Please try again.',
    });
  },
);
test('transport failures never retain raw exceptions in diagnostic properties', async () => {
  const maps = new GoogleMapsProvider('synthetic-secret', area, async () => {
    throw new Error('https://private-endpoint/?key=synthetic-secret');
  });
  try {
    await maps.search('Public station');
    throw new Error('expected rejection');
  } catch (error) {
    expect(error).toMatchObject({ code: 'MAPS_UNAVAILABLE', upstreamStatus: undefined });
    expect(JSON.stringify(error)).not.toMatch(/private-endpoint|synthetic-secret/);
    expect(String(error)).not.toMatch(/private-endpoint|synthetic-secret/);
  }
});

test('nearby uses a bounded distance-ranked circle and rejects malformed coordinates before dispatch', async () => {
  const transport = vi.fn(
    async (_url: string, _options: RequestInit) => new Response(JSON.stringify({ places: [fixture] })),
  );
  const maps = new GoogleMapsProvider('fixture-key', area, transport);
  expect(await maps.nearby(fixture.location)).toHaveLength(1);
  const [url, options] = transport.mock.calls[0]!;
  expect(url).toBe('https://places.googleapis.com/v1/places:searchNearby');
  expect(JSON.parse(String(options.body))).toMatchObject({
    maxResultCount: 5,
    rankPreference: 'DISTANCE',
    locationRestriction: { circle: { center: fixture.location, radius: 5000 } },
  });
  await expect(maps.nearby({ latitude: 91, longitude: 0 })).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});
