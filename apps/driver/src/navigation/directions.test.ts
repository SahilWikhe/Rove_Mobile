import { expect, test, vi } from 'vitest';
import type { RideDetails } from '@rove/contracts';
import { navigationTarget, openTripDirections } from './directions';
const ride: RideDetails = {
  id: '00000000-0000-4000-8000-000000000001',
  state: 'en_route',
  version: 2,
  fare: { amount: 1000, currency: 'USD' },
  paymentState: 'authorized',
  pickupArea: 'Downtown',
  destinationArea: 'North',
  createdAt: '2026-09-08T00:00:00.000Z',
  pickup: { id: 'home', label: 'Home', area: 'Downtown', coordinate: { latitude: 35.78, longitude: -78.64 } },
  destination: { id: 'work', label: 'Work', area: 'North', coordinate: { latitude: 35.8, longitude: -78.6 } },
};
function setup(latest = ride) {
  return {
    expected: ride,
    signal: new AbortController().signal,
    load: vi.fn(async () => latest),
    open: vi.fn(async (_url: string) => undefined),
  };
}
test('opens a fresh pickup without forwarding identity, label, origin or credentials', async () => {
  const deps = setup({ ...ride, state: 'arrived', version: 3 });
  await openTripDirections(deps);
  expect(deps.load).toHaveBeenCalledWith(ride.id, deps.signal);
  expect(deps.open).toHaveBeenCalledWith(ride.id);
});
test('onboard trip targets destination and terminal/interrupted trips never expose navigation', () => {
  expect(navigationTarget({ ...ride, state: 'in_progress' })?.point).toBe('35.8,-78.6');
  for (const state of ['completed', 'cancelled', 'interrupted', 'searching'] as const)
    expect(navigationTarget({ ...ride, state })).toBeNull();
  expect(navigationTarget({ ...ride, pickup: undefined })).toBeNull();
});
test('changed leg, changed coordinates, ended trip, wrong ID and older read cannot launch', async () => {
  for (const latest of [
    { ...ride, state: 'in_progress' as const, version: 3 },
    { ...ride, pickup: ride.destination },
    { ...ride, state: 'completed' as const },
    { ...ride, id: 'another-trip' },
    { ...ride, version: 1 },
  ]) {
    const deps = setup(latest);
    await expect(openTripDirections(deps)).rejects.toThrow('trip changed');
    expect(deps.open).not.toHaveBeenCalled();
  }
});
test('authorization/network failure cannot fall back to cached coordinates', async () => {
  const deps = setup();
  deps.load.mockRejectedValue(new Error('Forbidden'));
  await expect(openTripDirections(deps)).rejects.toThrow('Forbidden');
  expect(deps.open).not.toHaveBeenCalled();
});
test('late response after cancellation cannot open navigation even if transport ignores abort', async () => {
  const controller = new AbortController();
  const deps = setup();
  deps.signal = controller.signal;
  deps.load.mockImplementation(async () => {
    controller.abort();
    return ride;
  });
  await openTripDirections(deps);
  expect(deps.open).not.toHaveBeenCalled();
  deps.load.mockClear();
  await openTripDirections(deps);
  expect(deps.load).not.toHaveBeenCalled();
});
test('invalid coordinates and platform launch errors fail without retries', async () => {
  expect(
    navigationTarget({ ...ride, pickup: { ...ride.pickup!, coordinate: { latitude: NaN, longitude: 0 } } }),
  ).toBeNull();
  const deps = setup();
  deps.open.mockRejectedValue(new Error('Maps unavailable'));
  await expect(openTripDirections(deps)).rejects.toThrow('Maps unavailable');
  expect(deps.open).toHaveBeenCalledOnce();
});
