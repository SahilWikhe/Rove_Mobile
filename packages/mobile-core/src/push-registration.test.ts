import { expect, test, vi } from 'vitest';
const randomUUID = () => crypto.randomUUID();
import { PushRegistration } from './push-registration';
import { ApiError } from './index';
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
function setup() {
  let stored: string | null = null;
  const identity = { installationId: randomUUID(), secret: 's'.repeat(43) };
  let revision: number | null = null,
    enabled = false;
  const events: string[] = [];
  const storage = {
    read: vi.fn(async () => stored),
    write: vi.fn(async (value: string) => {
      events.push('persist');
      stored = value;
    }),
  };
  const api = {
    pushInstallationStatus: vi.fn(async () => ({
      installationId: identity.installationId,
      revision,
      enabled,
    })),
    registerPushInstallation: vi.fn(async () => {
      events.push('register');
      revision = (revision ?? 0) + 1;
      enabled = true;
      return { installationId: identity.installationId, revision, enabled };
    }),
    removePushInstallation: vi.fn(async () => {
      events.push('remove');
      revision = (revision ?? 0) + 1;
      enabled = false;
      return { installationId: identity.installationId, revision, enabled };
    }),
  };
  const controller = new PushRegistration(storage, () => identity, randomUUID);
  return {
    controller,
    storage,
    api,
    events,
    identity,
    stored: () => stored,
    setStored: (value: string) => {
      stored = value;
    },
  };
}
test('persists installation and exact intent before remote work; disable preserves fencing identity', async () => {
  const s = setup();
  await s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true);
  expect(s.events.indexOf('persist')).toBeLessThan(s.events.indexOf('register'));
  expect(await s.controller.wantsEnabled()).toBe(true);
  await s.controller.disable(a, s.api, () => true);
  const state = JSON.parse(s.stored()!);
  expect(state).toMatchObject({ ...s.identity, revision: 2, pending: null, wanted: false });
});
test('storage failure prevents external registration and preserves identity on retry', async () => {
  const s = setup();
  s.storage.write.mockRejectedValueOnce(new Error('Locked'));
  await expect(s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true)).rejects.toThrow(
    'Locked',
  );
  expect(s.api.registerPushInstallation).not.toHaveBeenCalled();
  await s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true);
  expect(s.api.registerPushInstallation).toHaveBeenCalledOnce();
});
test('lost registration response is replayed unchanged before revocation', async () => {
  const s = setup();
  s.api.registerPushInstallation.mockRejectedValueOnce(new Error('Connection lost'));
  await expect(s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true)).rejects.toThrow(
    'Connection lost',
  );
  const pending = JSON.parse(s.stored()!).pending;
  await s.controller.disable(a, s.api, () => true);
  expect(s.api.registerPushInstallation.mock.calls[0]).toEqual(s.api.registerPushInstallation.mock.calls[1]);
  expect(s.api.registerPushInstallation.mock.calls[1]).toEqual([pending.input]);
  expect(s.events.filter((e) => e !== 'persist')).toEqual(['register', 'remove']);
  expect(JSON.parse(s.stored()!).pending).toBeNull();
});
test('failed persistence after acknowledgment retains recoverable intent', async () => {
  const s = setup();
  s.api.registerPushInstallation.mockImplementationOnce(async () => {
    s.storage.write.mockRejectedValueOnce(new Error('Disk unavailable'));
    return { installationId: s.identity.installationId, revision: 1, enabled: true };
  });
  await expect(s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true)).rejects.toThrow(
    'Disk unavailable',
  );
  expect(JSON.parse(s.stored()!).pending.kind).toBe('register');
});
test('new account never replays the prior account mutation', async () => {
  const s = setup();
  s.api.registerPushInstallation.mockRejectedValueOnce(new Error('Offline'));
  await expect(s.controller.enable(a, 'ExpoPushToken[old]', 'ios', s.api, () => true)).rejects.toThrow();
  s.api.registerPushInstallation.mockClear();
  await s.controller.enable(b, 'ExpoPushToken[new]', 'ios', s.api, () => true);
  expect(s.api.registerPushInstallation).toHaveBeenCalledOnce();
  expect(s.api.registerPushInstallation.mock.calls[0]).toMatchObject([{ token: 'ExpoPushToken[new]' }]);
});
test('account change during a read or write prevents late remote mutation', async () => {
  const s = setup();
  let current = true;
  s.api.pushInstallationStatus.mockImplementationOnce(async () => {
    current = false;
    return { installationId: s.identity.installationId, revision: null, enabled: false };
  });
  await expect(s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => current)).rejects.toThrow(
    'account changed',
  );
  expect(s.api.registerPushInstallation).not.toHaveBeenCalled();
});
test('a stale receipt revision conflict recovers current state without replay loops', async () => {
  const s = setup();
  s.api.registerPushInstallation.mockRejectedValueOnce(new Error('Lost'));
  await expect(s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true)).rejects.toThrow();
  s.api.registerPushInstallation.mockRejectedValueOnce(
    new ApiError('PUSH_REGISTRATION_CHANGED', 'Changed', 409),
  );
  await s.controller.disable(a, s.api, () => true);
  expect(s.api.registerPushInstallation).toHaveBeenCalledTimes(2);
  expect(JSON.parse(s.stored()!).pending).toBeNull();
});
test('corrupt storage is not replaced and an unused installation needs no logout API call', async () => {
  const s = setup();
  await s.controller.disable(a, s.api, () => true);
  expect(s.api.pushInstallationStatus).not.toHaveBeenCalled();
  s.setStored('{"wrong":true}');
  await expect(s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true)).rejects.toThrow(
    'storage needs recovery',
  );
  expect(s.storage.write).not.toHaveBeenCalled();
});
test('wrong-installation response fails without accepting it into storage', async () => {
  const s = setup();
  s.api.registerPushInstallation.mockResolvedValueOnce({
    installationId: randomUUID(),
    revision: 1,
    enabled: true,
  });
  await expect(s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true)).rejects.toThrow(
    'could not be verified',
  );
  expect(JSON.parse(s.stored()!).pending).not.toBeNull();
});

test('passive refresh respects remote revocation until explicit opt-in', async () => {
  const s = setup();
  await s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true);
  s.api.pushInstallationStatus.mockResolvedValue({
    installationId: s.identity.installationId,
    revision: 2,
    enabled: false,
  });
  s.api.registerPushInstallation.mockClear();
  expect(await s.controller.enable(a, 'ExpoPushToken[new]', 'ios', s.api, () => true, false)).toBe(false);
  expect(s.api.registerPushInstallation).not.toHaveBeenCalled();
  expect(await s.controller.wantsEnabled()).toBe(false);
  s.api.registerPushInstallation.mockResolvedValue({
    installationId: s.identity.installationId,
    revision: 3,
    enabled: true,
  });
  s.api.pushInstallationStatus
    .mockResolvedValueOnce({ installationId: s.identity.installationId, revision: 2, enabled: false })
    .mockResolvedValueOnce({ installationId: s.identity.installationId, revision: 3, enabled: true });
  expect(await s.controller.enable(a, 'ExpoPushToken[new]', 'ios', s.api, () => true, true)).toBe(true);
  expect(s.api.registerPushInstallation).toHaveBeenCalledOnce();
});
test('revocation that races token refresh cannot report enabled or silently retry against the new revision', async () => {
  const s = setup();
  await s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true);
  s.api.registerPushInstallation
    .mockClear()
    .mockRejectedValueOnce(new ApiError('PUSH_REGISTRATION_CHANGED', 'Changed', 409));
  s.api.pushInstallationStatus
    .mockResolvedValueOnce({ installationId: s.identity.installationId, revision: 1, enabled: true })
    .mockResolvedValue({ installationId: s.identity.installationId, revision: 2, enabled: false });
  expect(await s.controller.enable(a, 'ExpoPushToken[new]', 'ios', s.api, () => true, false)).toBe(false);
  expect(s.api.registerPushInstallation).toHaveBeenCalledOnce();
  expect(await s.controller.wantsEnabled()).toBe(false);
});
