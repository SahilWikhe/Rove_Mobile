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

test('explicit repair verifies the saved proof and preserves identity before a fresh registration', async () => {
  const s = setup();
  await s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true);
  const damaged = { ...JSON.parse(s.stored()!), revision: 'broken', pending: { kind: 'unknown' } };
  s.setStored(JSON.stringify(damaged));
  await expect(s.controller.wantsEnabled()).rejects.toMatchObject({ repairable: true });
  const mutations = s.api.registerPushInstallation.mock.calls.length;
  await s.controller.repair(s.api, () => true);
  expect(s.api.registerPushInstallation).toHaveBeenCalledTimes(mutations);
  expect(s.api.removePushInstallation).not.toHaveBeenCalled();
  expect(JSON.parse(s.stored()!)).toMatchObject({ ...s.identity, revision: 1, wanted: false, pending: null });
  await s.controller.enable(a, 'ExpoPushToken[renewed]', 'ios', s.api, () => true);
  expect(s.api.registerPushInstallation).toHaveBeenLastCalledWith(
    expect.objectContaining({
      ...s.identity,
      expectedRevision: 1,
      token: 'ExpoPushToken[renewed]',
    }),
  );
});

test('pending proof mismatch is rejected without replaying another installation mutation', async () => {
  const s = setup();
  s.api.registerPushInstallation.mockRejectedValueOnce(new Error('Offline'));
  await expect(s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true)).rejects.toThrow();
  const damaged = JSON.parse(s.stored()!);
  damaged.pending.input.installationId = randomUUID();
  s.setStored(JSON.stringify(damaged));
  await expect(s.controller.disable(a, s.api, () => true)).rejects.toMatchObject({ repairable: true });
  expect(s.api.registerPushInstallation).toHaveBeenCalledOnce();
  await s.controller.repair(s.api, () => true);
  expect(JSON.parse(s.stored()!).installationId).toBe(s.identity.installationId);
  expect(s.api.registerPushInstallation).toHaveBeenCalledOnce();
});

test('repair leaves damaged storage untouched when server verification fails or the account changes', async () => {
  const s = setup();
  const raw = JSON.stringify({ ...s.identity, revision: 'broken' });
  s.setStored(raw);
  s.api.pushInstallationStatus.mockRejectedValueOnce(
    new ApiError('PUSH_INSTALLATION_FORBIDDEN', 'Forbidden', 403),
  );
  await expect(s.controller.repair(s.api, () => true)).rejects.toThrow('Forbidden');
  expect(s.stored()).toBe(raw);
  let current = true;
  s.api.pushInstallationStatus.mockImplementationOnce(async () => {
    current = false;
    return { installationId: s.identity.installationId, revision: null, enabled: false };
  });
  await expect(s.controller.repair(s.api, () => current)).rejects.toThrow('account changed');
  expect(s.stored()).toBe(raw);
  expect(s.storage.write).not.toHaveBeenCalled();
});

test('lost proof cannot be silently replaced and a healthy pending mutation is not discarded', async () => {
  const s = setup();
  s.setStored('{"revision":"broken"}');
  await expect(s.controller.repair(s.api, () => true)).rejects.toMatchObject({ repairable: false });
  expect(s.storage.write).not.toHaveBeenCalled();
  expect(s.api.pushInstallationStatus).not.toHaveBeenCalled();
  s.setStored(
    JSON.stringify({
      ...s.identity,
      revision: null,
      wanted: true,
      pending: {
        kind: 'register',
        accountId: a,
        input: {
          ...s.identity,
          mutationId: randomUUID(),
          expectedRevision: null,
          token: 'ExpoPushToken[first]',
          platform: 'ios',
        },
      },
    }),
  );
  const raw = s.stored();
  await s.controller.repair(s.api, () => true);
  expect(s.stored()).toBe(raw);
  expect(s.storage.write).not.toHaveBeenCalled();
});

test('a failed repair write can retry with the same proof', async () => {
  const s = setup();
  const raw = JSON.stringify({ ...s.identity, wanted: 'broken' });
  s.setStored(raw);
  s.storage.write.mockRejectedValueOnce(new Error('Locked'));
  await expect(s.controller.repair(s.api, () => true)).rejects.toThrow('Locked');
  expect(s.stored()).toBe(raw);
  await s.controller.repair(s.api, () => true);
  expect(JSON.parse(s.stored()!)).toMatchObject({ ...s.identity, wanted: false, pending: null });
});

test('repair rejects a response for a different installation without replacing the saved proof', async () => {
  const s = setup();
  const raw = JSON.stringify({ ...s.identity, revision: 'broken' });
  s.setStored(raw);
  s.api.pushInstallationStatus.mockResolvedValueOnce({
    installationId: randomUUID(),
    revision: 2,
    enabled: true,
  });
  await expect(s.controller.repair(s.api, () => true)).rejects.toThrow('could not be verified');
  expect(s.stored()).toBe(raw);
  expect(s.storage.write).not.toHaveBeenCalled();
});

test('explicit lost-proof reset requires an empty authorized device list and stays opted out', async () => {
  const s = setup();
  s.setStored('{broken');
  const notificationDevices = vi.fn(async () => ({ devices: [] }));
  await s.controller.resetLostProof({ notificationDevices }, () => true);
  expect(notificationDevices).toHaveBeenCalledOnce();
  expect(JSON.parse(s.stored()!)).toEqual({ ...s.identity, revision: null, pending: null, wanted: false });
  expect(await s.controller.wantsEnabled()).toBe(false);
  expect(s.api.registerPushInstallation).not.toHaveBeenCalled();
  expect(s.api.removePushInstallation).not.toHaveBeenCalled();
});

test('remaining enabled devices or invalid server output blocks lost-proof reset without a write', async () => {
  const s = setup();
  const raw = '{"secret":"lost"}';
  s.setStored(raw);
  const notificationDevices = vi.fn(async () => ({
    devices: [
      { id: randomUUID(), revision: 1, platform: 'ios' as const, registeredAt: new Date().toISOString() },
    ],
  }));
  await expect(s.controller.resetLostProof({ notificationDevices }, () => true)).rejects.toThrow(
    'Turn off all notification devices',
  );
  const malformed = { notificationDevices: vi.fn(async () => ({ devices: null })) };
  await expect(s.controller.resetLostProof(malformed as never, () => true)).rejects.toThrow();
  expect(s.stored()).toBe(raw);
  expect(s.storage.write).not.toHaveBeenCalled();
});

test('lost-proof reset preserves damaged storage on failed authorization or account changes', async () => {
  const s = setup();
  const raw = '{"revision":5}';
  s.setStored(raw);
  const notificationDevices = vi.fn(async (): Promise<{ devices: [] }> => {
    throw new ApiError('FORBIDDEN', 'Unavailable', 403);
  });
  await expect(s.controller.resetLostProof({ notificationDevices }, () => true)).rejects.toThrow(
    'Unavailable',
  );
  let current = true;
  notificationDevices.mockImplementationOnce(async () => {
    current = false;
    return { devices: [] };
  });
  await expect(s.controller.resetLostProof({ notificationDevices }, () => current)).rejects.toThrow(
    'account changed',
  );
  expect(s.stored()).toBe(raw);
  expect(s.storage.write).not.toHaveBeenCalled();
});

test('reset cannot replace a recoverable proof or discard a healthy pending registration', async () => {
  const s = setup();
  const notificationDevices = vi.fn(async () => ({ devices: [] }));
  const repairable = JSON.stringify({ ...s.identity, revision: 'broken' });
  s.setStored(repairable);
  await expect(s.controller.resetLostProof({ notificationDevices }, () => true)).rejects.toMatchObject({
    repairable: true,
  });
  expect(s.stored()).toBe(repairable);
  s.setStored(JSON.stringify({ ...s.identity, revision: null, pending: null, wanted: false }));
  s.api.registerPushInstallation.mockRejectedValueOnce(new Error('Lost response'));
  await expect(s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true)).rejects.toThrow();
  const pending = s.stored();
  await s.controller.resetLostProof({ notificationDevices }, () => true);
  expect(s.stored()).toBe(pending);
  expect(notificationDevices).not.toHaveBeenCalled();
});

test('failed reset persistence can be retried and stale repeated confirmation preserves new identity', async () => {
  const s = setup();
  const raw = '{"unknown":true}';
  s.setStored(raw);
  const notificationDevices = vi.fn(async () => ({ devices: [] }));
  s.storage.write.mockRejectedValueOnce(new Error('Locked'));
  await expect(s.controller.resetLostProof({ notificationDevices }, () => true)).rejects.toThrow('Locked');
  expect(s.stored()).toBe(raw);
  await s.controller.resetLostProof({ notificationDevices }, () => true);
  const fresh = s.stored();
  await s.controller.resetLostProof({ notificationDevices }, () => true);
  expect(s.stored()).toBe(fresh);
  expect(notificationDevices).toHaveBeenCalledTimes(2);
});

test('post-reset token conflict cannot claim notifications are enabled or revoke the other installation', async () => {
  const s = setup();
  s.setStored('{broken');
  await s.controller.resetLostProof({ notificationDevices: async () => ({ devices: [] }) }, () => true);
  s.api.registerPushInstallation.mockRejectedValueOnce(
    new ApiError('PUSH_REGISTRATION_CHANGED', 'Changed', 409),
  );
  expect(await s.controller.enable(a, 'ExpoPushToken[first]', 'ios', s.api, () => true)).toBe(false);
  expect(await s.controller.wantsEnabled()).toBe(false);
  expect(s.api.removePushInstallation).not.toHaveBeenCalled();
});
