import { expect, test, vi } from 'vitest';
import type { RideDetails } from '@rove/contracts';
import { createGuidance, type GuidancePorts } from './guidance';
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
function setup() {
  const ports = {
    load: vi.fn(async () => ride),
    prepare: vi.fn(async () => {}),
    route: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    cleanup: vi.fn(async () => {}),
  } satisfies GuidancePorts;
  return { ports, session: createGuidance(ports) };
}
test('revalidates ownership after permission/terms and route calculation before starting', async () => {
  const { ports, session } = setup();
  await session.start();
  expect(ports.load).toHaveBeenCalledTimes(3);
  expect(ports.route).toHaveBeenCalledWith(
    expect.objectContaining({ leg: 'pickup', coordinate: { latitude: 35.78, longitude: -78.64 } }),
    expect.any(AbortSignal),
  );
  expect(ports.start).toHaveBeenCalledOnce();
  await session.dispose();
  expect(ports.cleanup).toHaveBeenCalledOnce();
});
test('trip cancelled while terms are open never calculates a route', async () => {
  const { ports, session } = setup();
  ports.prepare.mockImplementation(async () => {
    ports.load.mockResolvedValue({ ...ride, state: 'cancelled', version: 3 });
  });
  await expect(session.start()).rejects.toThrow('trip changed');
  expect(ports.route).not.toHaveBeenCalled();
  await session.dispose();
});
test('changed destination after route calculation never starts stale guidance', async () => {
  const { ports, session } = setup();
  ports.route.mockImplementation(async () => {
    ports.load.mockResolvedValue({ ...ride, state: 'in_progress', version: 3 });
  });
  await expect(session.start()).rejects.toThrow('trip changed');
  expect(ports.start).not.toHaveBeenCalled();
  await session.dispose();
});
test('lost authorization never starts guidance and fails ongoing validation', async () => {
  const { ports, session } = setup();
  ports.load.mockRejectedValue(new Error('Forbidden'));
  await expect(session.start()).rejects.toThrow('Forbidden');
  expect(ports.prepare).not.toHaveBeenCalled();
  await session.dispose();
  const second = setup();
  await second.session.start();
  second.ports.load.mockRejectedValue(new Error('Forbidden'));
  await expect(second.session.validate()).rejects.toThrow('Forbidden');
  await second.session.dispose();
});
test('late native start after leaving is stopped again and cleaned exactly once', async () => {
  const { ports, session } = setup();
  let finish!: () => void;
  ports.start.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const running = session.start();
  const rejected = expect(running).rejects.toThrow();
  await vi.waitFor(() => expect(ports.start).toHaveBeenCalledOnce());
  const disposed = session.dispose();
  expect(session.dispose()).toBe(disposed);
  finish();
  await rejected;
  await disposed;
  expect(ports.stop).toHaveBeenCalledTimes(2);
  expect(ports.cleanup).toHaveBeenCalledOnce();
});
test('native failure and denied terms cannot fall back to external navigation', async () => {
  const { ports, session } = setup();
  ports.prepare.mockRejectedValue(new Error('Terms declined'));
  await expect(session.start()).rejects.toThrow('Terms declined');
  expect(ports.route).not.toHaveBeenCalled();
  expect(ports.start).not.toHaveBeenCalled();
  await session.dispose();
});

test('route failure cleans up and a new attempt routes only the latest trip leg', async () => {
  const first = setup();
  first.ports.route.mockRejectedValue(new Error('NETWORK_ERROR'));
  await expect(first.session.start()).rejects.toThrow('NETWORK_ERROR');
  expect(first.ports.start).not.toHaveBeenCalled();
  await first.session.dispose();
  expect(first.ports.cleanup).toHaveBeenCalledOnce();

  const retry = setup();
  retry.ports.load.mockResolvedValue({ ...ride, state: 'in_progress', version: 4 });
  await retry.session.start();
  expect(retry.ports.route).toHaveBeenCalledWith(
    expect.objectContaining({ leg: 'destination', coordinate: { latitude: 35.8, longitude: -78.6 } }),
    expect.any(AbortSignal),
  );
  await retry.session.dispose();
});

test('leaving while a route request is pending prevents its late result from starting guidance', async () => {
  const { ports, session } = setup();
  let finish!: () => void;
  ports.route.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const attempt = session.start();
  const rejection = expect(attempt).rejects.toThrow('Navigation cancelled');
  await vi.waitFor(() => expect(ports.route).toHaveBeenCalledOnce());
  const disposal = session.dispose();
  expect(ports.stop).toHaveBeenCalledOnce();
  finish();
  await rejection;
  await disposal;
  expect(ports.start).not.toHaveBeenCalled();
  expect(ports.cleanup).toHaveBeenCalledOnce();
});
