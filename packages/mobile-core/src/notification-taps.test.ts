import { expect, test, vi } from 'vitest';
import { createNotificationTaps } from './notification-taps';
const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const hint = (kind = 'ride_update', referenceId = id) => ({
  eventId: crypto.randomUUID(),
  kind,
  referenceId,
});
function setup(role: 'rider' | 'driver' = 'rider') {
  let active = true;
  const api = {
    ride: vi.fn(async (referenceId: string, _signal?: AbortSignal) => ({ id: referenceId })),
    offers: vi.fn(async (_signal?: AbortSignal) => ({
      offers: [{ id, expiresAt: new Date(2000).toISOString() }],
    })),
  };
  const navigate = vi.fn();
  const taps = createNotificationTaps(
    role,
    api,
    () => active,
    navigate,
    () => 1000,
  );
  return {
    api,
    navigate,
    taps,
    signOut: () => {
      active = false;
    },
  };
}
test('refreshes owned rides before opening the role-specific screen and deduplicates events', async () => {
  for (const role of ['rider', 'driver'] as const) {
    const s = setup(role),
      data = hint();
    expect(await s.taps.open(data)).toBe('opened');
    expect(s.api.ride).toHaveBeenCalledWith(id, expect.any(AbortSignal));
    expect(s.navigate).toHaveBeenCalledWith({
      pathname: role === 'rider' ? '/ride' : '/trip',
      params: { id },
    });
    expect(await s.taps.open(data)).toBe('ignored');
    expect(s.navigate).toHaveBeenCalledTimes(1);
  }
});
test('rejects arbitrary destinations, extra fields, malformed IDs and rider offer payloads', async () => {
  const s = setup();
  for (const data of [
    null,
    { url: '/account' },
    { ...hint(), url: 'https://evil.invalid' },
    hint('ride_update', '../account'),
    hint('offer_available'),
  ])
    expect(await s.taps.open(data)).toBe('ignored');
  expect(s.api.ride).not.toHaveBeenCalled();
  expect(s.api.offers).not.toHaveBeenCalled();
  expect(s.navigate).not.toHaveBeenCalled();
});
test('opens only an offer that is still in the current account feed and unexpired', async () => {
  const s = setup('driver');
  expect(await s.taps.open(hint('offer_available'))).toBe('opened');
  s.navigate.mockClear();
  for (const offers of [
    [],
    [{ id: other, expiresAt: new Date(2000).toISOString() }],
    [{ id, expiresAt: new Date(1000).toISOString() }],
    [{ id, expiresAt: 'invalid' }],
  ]) {
    s.api.offers.mockResolvedValueOnce({ offers });
    expect(await s.taps.open(hint('offer_available'))).toBe('unavailable');
  }
  expect(s.navigate).not.toHaveBeenCalled();
});
test('permission failures and mismatched responses never open a screen', async () => {
  const s = setup();
  s.api.ride.mockRejectedValueOnce(new Error('forbidden'));
  expect(await s.taps.open(hint())).toBe('unavailable');
  s.api.ride.mockResolvedValueOnce({ id: other });
  expect(await s.taps.open(hint())).toBe('unavailable');
  expect(s.navigate).not.toHaveBeenCalled();
});
test('signed-out taps never read data, and sign-out fences a read that ignores abort', async () => {
  const s = setup();
  let finish!: (value: { id: string }) => void;
  s.api.ride.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = s.taps.open(hint());
  s.signOut();
  finish({ id });
  expect(await pending).toBe('ignored');
  expect(await s.taps.open(hint())).toBe('ignored');
  expect(s.api.ride).toHaveBeenCalledTimes(1);
  expect(s.navigate).not.toHaveBeenCalled();
});
test('newer taps supersede old responses and cancellation fences unmounted handlers', async () => {
  const s = setup();
  let finish!: (value: { id: string }) => void;
  s.api.ride.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = s.taps.open(hint());
  expect(await s.taps.open(hint('ride_update', other))).toBe('opened');
  expect(s.api.ride.mock.calls[0]?.[1]?.aborted).toBe(true);
  finish({ id });
  expect(await pending).toBe('ignored');
  expect(s.navigate).toHaveBeenCalledTimes(1);
  s.api.ride.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const unmounted = s.taps.open(hint());
  s.taps.cancel();
  finish({ id });
  expect(await unmounted).toBe('ignored');
  expect(s.navigate).toHaveBeenCalledTimes(1);
});
