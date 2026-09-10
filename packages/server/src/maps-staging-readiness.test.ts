import { expect, test, vi } from 'vitest';
import { inspectMapsStaging } from './maps-staging-readiness';
const env = {
  ROVE_ENVIRONMENT: 'staging',
  GOOGLE_MAPS_API_KEY: 'synthetic-private-key',
  SERVICE_AREA_JSON: JSON.stringify({ south: 35, north: 37, west: -80, east: -77 }),
};
const queries = { pickup: 'Synthetic public station', destination: 'Synthetic public park' };
function fixture() {
  const place = (id: string) => ({
    id,
    label: 'Synthetic public place',
    area: 'Synthetic city',
    coordinate: { latitude: 35.8, longitude: -78.6 },
  });
  const provider = {
    search: vi.fn(async (q: string) => [place(q === queries.pickup ? 'pickup' : 'destination')]),
    resolve: vi.fn(async (id: string) => place(id)),
    route: vi.fn(async () => ({ distanceMeters: 1500, durationSeconds: 300 })),
  };
  const create = vi.fn(() => provider);
  return { provider, create, place };
}
test('checks two searched and resolved locations and a usable route with bounded requests', async () => {
  const f = fixture();
  expect(await inspectMapsStaging(env, queries, f.create, true)).toEqual({
    distanceMeters: 1500,
    durationSeconds: 300,
  });
  expect(f.provider.search).toHaveBeenCalledTimes(2);
  expect(f.provider.resolve).toHaveBeenCalledTimes(2);
  expect(f.provider.route).toHaveBeenCalledTimes(1);
});
test('no opt-in, production, malformed area and missing key cannot start provider calls', async () => {
  const f = fixture();
  await expect(inspectMapsStaging(env, queries, f.create)).rejects.toMatchObject({ stage: 'configuration' });
  for (const settings of [
    { ...env, ROVE_ENVIRONMENT: 'production' },
    { ...env, GOOGLE_MAPS_API_KEY: '' },
    { ...env, SERVICE_AREA_JSON: 'private-invalid-json' },
  ])
    await expect(inspectMapsStaging(settings, queries, f.create, true)).rejects.toMatchObject({
      stage: 'configuration',
    });
  expect(f.create).not.toHaveBeenCalled();
});
test('provider errors are sanitized and identify the failing capability', async () => {
  const f = fixture();
  f.provider.resolve.mockRejectedValue(new Error('synthetic-private-key private address'));
  await expect(inspectMapsStaging(env, queries, f.create, true)).rejects.toMatchObject({
    message: 'Maps staging check failed at pickup details.',
  });
  expect(f.provider.route).not.toHaveBeenCalled();
});
test('empty or out-of-area search results cannot produce a passing readiness check', async () => {
  const f = fixture();
  f.provider.search.mockResolvedValue([]);
  await expect(inspectMapsStaging(env, queries, f.create, true)).rejects.toMatchObject({
    stage: 'pickup search',
  });
  f.provider.search.mockResolvedValue([{ ...f.place('outside'), coordinate: { latitude: 0, longitude: 0 } }]);
  await expect(inspectMapsStaging(env, queries, f.create, true)).rejects.toMatchObject({
    stage: 'pickup search',
  });
  expect(f.provider.resolve).not.toHaveBeenCalled();
});
test('changed resolution or zero-length route is rejected', async () => {
  const f = fixture();
  f.provider.resolve.mockImplementation(async () => f.place('wrong'));
  await expect(inspectMapsStaging(env, queries, f.create, true)).rejects.toMatchObject({
    stage: 'pickup details',
  });
  f.provider.resolve.mockImplementation(async (id) => f.place(id));
  f.provider.route.mockResolvedValue({ distanceMeters: 0, durationSeconds: 0 });
  await expect(inspectMapsStaging(env, queries, f.create, true)).rejects.toMatchObject({
    stage: 'driving route',
  });
});
