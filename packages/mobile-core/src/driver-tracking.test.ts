import { describe, expect, it, vi } from 'vitest';
import { DriverTracking } from './driver-tracking';

const sample = { coordinate: { latitude: 35.78, longitude: -78.64 }, sampledAt: '2026-09-07T12:00:00.000Z', accuracyMeters: 5 };
function setup() {
  const dependencies = {
    profile: vi.fn(async (_signal: AbortSignal) => ({ online: true, locationSequence: 42 })),
    position: vi.fn(async () => sample),
    heartbeat: vi.fn(async () => ({ accepted: true })),
    report: vi.fn(),
  };
  const tracking = new DriverTracking(dependencies);
  tracking.setActive(true);
  return { tracking, ...dependencies };
}
describe('app-owned driver tracking', () => {
  it('takes no GPS sample while offline and resumes with the server sequence', async () => {
    const t = setup();
    t.profile.mockResolvedValueOnce({ online: false, locationSequence: 42 });
    await t.tracking.tick();
    expect(t.position).not.toHaveBeenCalled();
    t.profile.mockResolvedValueOnce({ online: true, locationSequence: 84 });
    await t.tracking.tick();
    expect(t.heartbeat).toHaveBeenCalledWith({ ...sample, sequence: 85 }, expect.any(AbortSignal));
  });
  it('does not send a late GPS sample after backgrounding or sign-out', async () => {
    const t = setup();
    let resolve!: (value: typeof sample) => void;
    t.position.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = t.tracking.tick();
    await vi.waitFor(() => expect(t.position).toHaveBeenCalledOnce());
    t.tracking.setActive(false);
    t.tracking.setActive(true);
    resolve(sample);
    await pending;
    expect(t.heartbeat).not.toHaveBeenCalled();
    await t.tracking.tick();
    expect(t.heartbeat).toHaveBeenCalledOnce();
  });
  it('aborts pending requests and prevents overlapping update cycles', async () => {
    const t = setup();
    let resolve!: (value: { online: boolean; locationSequence: number }) => void;
    t.profile.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = t.tracking.tick();
    await t.tracking.tick();
    expect(t.profile).toHaveBeenCalledOnce();
    const signal = t.profile.mock.calls[0]![0];
    t.tracking.setActive(false);
    expect(signal.aborted).toBe(true);
    resolve({ online: true, locationSequence: 1 });
    await pending;
    expect(t.position).not.toHaveBeenCalled();
  });
  it('recovers after failure using a fresh sample and cursor, without replaying old GPS', async () => {
    const t = setup();
    t.profile.mockRejectedValueOnce(new Error('network failure'));
    await t.tracking.tick();
    expect(t.report).toHaveBeenLastCalledWith(expect.any(String));
    expect(t.heartbeat).not.toHaveBeenCalled();
    await t.tracking.tick();
    expect(t.report).toHaveBeenLastCalledWith(null);
    expect(t.heartbeat).toHaveBeenCalledOnce();
  });
});
