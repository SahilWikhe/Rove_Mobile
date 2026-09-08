import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { users } from '@rove/database';
import { PushInstallations } from './push-installations';
let database: Awaited<ReturnType<typeof testDatabase>>;
const projects = { rider: randomUUID(), driver: randomUUID() };
let service: PushInstallations;
let a: { id: string; role: 'rider' }, b: { id: string; role: 'rider' };
const input = () => ({
  installationId: randomUUID(),
  secret: randomBytes(32).toString('base64url'),
  mutationId: randomUUID(),
  expectedRevision: null,
  token: `ExpoPushToken[${randomUUID()}]`,
  platform: 'ios' as const,
});
beforeAll(async () => {
  database = await testDatabase();
  service = new PushInstallations(database.pool, projects);
}, 60000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  a = { id: randomUUID(), role: 'rider' };
  b = { id: randomUUID(), role: 'rider' };
  await database.db
    .insert(users)
    .values([a, b].map((actor) => ({ ...actor, subject: actor.id, name: 'Synthetic' })));
});
test('registration stores a secret hash and returns no token, owner or secret', async () => {
  const update = input();
  expect(await service.register(a, update)).toEqual({
    installationId: update.installationId,
    revision: 1,
    enabled: true,
  });
  const row = (await database.pool.query('SELECT * FROM push_installations')).rows[0];
  expect(row.secret_hash).not.toBe(update.secret);
  expect(JSON.stringify(row)).not.toContain(update.secret);
  const proof = { installationId: update.installationId, secret: update.secret };
  expect(await service.status(a, proof)).toEqual({
    installationId: update.installationId,
    revision: 1,
    enabled: true,
  });
  await expect(
    service.status(b, { ...proof, secret: randomBytes(32).toString('base64url') }),
  ).rejects.toMatchObject({ code: 'PUSH_INSTALLATION_FORBIDDEN' });
});
test('first writes serialize and an uncertain completed mutation is recoverable', async () => {
  const update = input();
  const result = await Promise.all([service.register(a, update), service.register(a, update)]);
  expect(result[0]).toEqual(result[1]);
  await expect(service.register(a, { ...update, token: 'ExpoPushToken[different]' })).rejects.toMatchObject({
    code: 'PUSH_REGISTRATION_CHANGED',
  });
  const competing = await Promise.allSettled([
    service.register(a, { ...update, mutationId: randomUUID(), expectedRevision: 1 }),
    service.register(a, { ...update, mutationId: randomUUID(), expectedRevision: 1 }),
  ]);
  expect(competing.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
});
test('account transfer requires proof and current revision; delayed logout and old receipt cannot disable it', async () => {
  const update = input();
  await service.register(a, update);
  const row = (await database.pool.query('SELECT id FROM push_installations')).rows[0];
  await expect(
    service.register(b, {
      ...update,
      secret: randomBytes(32).toString('base64url'),
      expectedRevision: 1,
      mutationId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'PUSH_INSTALLATION_FORBIDDEN' });
  await service.register(b, { ...update, expectedRevision: 1, mutationId: randomUUID() });
  await expect(
    service.remove(a, {
      installationId: update.installationId,
      secret: update.secret,
      expectedRevision: 1,
      mutationId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'PUSH_REGISTRATION_CHANGED' });
  expect(await service.invalidate(row.id, 1)).toEqual({ changed: false });
  expect(
    await service.status(b, { installationId: update.installationId, secret: update.secret }),
  ).toMatchObject({ revision: 2, enabled: true });
  await expect(service.register(a, update)).rejects.toMatchObject({ code: 'PUSH_REGISTRATION_CHANGED' });
});
test('revoke is retryable, receipt invalidation fences refresh and stale writes cannot reactivate', async () => {
  const update = input();
  await service.register(a, update);
  const row = (await database.pool.query('SELECT id FROM push_installations')).rows[0];
  expect(await service.invalidate(row.id, 1)).toEqual({ changed: true });
  expect(await service.invalidate(row.id, 1)).toEqual({ changed: false });
  await expect(service.register(a, update)).rejects.toMatchObject({ code: 'PUSH_REGISTRATION_CHANGED' });
  await service.register(a, { ...update, mutationId: randomUUID(), expectedRevision: 2 });
  const remove = {
    installationId: update.installationId,
    secret: update.secret,
    mutationId: randomUUID(),
    expectedRevision: 3,
  };
  expect(await service.remove(a, remove)).toMatchObject({ revision: 4, enabled: false });
  expect(await service.remove(a, remove)).toMatchObject({ revision: 4, enabled: false });
});
test('active token uniqueness and installation limits prevent duplicate fan-out', async () => {
  const update = input();
  await service.register(a, update);
  await expect(service.register(b, { ...input(), token: update.token })).rejects.toMatchObject({
    code: 'PUSH_REGISTRATION_CHANGED',
  });
  for (let i = 1; i < 10; i++) await service.register(a, input());
  await expect(service.register(a, input())).rejects.toMatchObject({ code: 'PUSH_INSTALLATION_LIMIT' });
});
test('disabled and forged roles cannot mutate; projects are configured server-side', async () => {
  const update = input();
  await expect(service.register({ ...a, role: 'driver' }, update)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(service.register({ ...a, role: 'staff' }, update)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await database.pool.query('UPDATE users SET disabled=true WHERE id=$1', [a.id]);
  await expect(service.register(a, update)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(new PushInstallations(database.pool, {}).register(b, input())).rejects.toMatchObject({
    code: 'PUSH_UNAVAILABLE',
  });
  expect(
    () => new PushInstallations(database.pool, { rider: projects.rider, driver: projects.rider }),
  ).toThrow('must differ');
});

test('device listing contains only current owned registrations and excludes credentials', async () => {
  await service.register(a, input());
  await service.register(b, input());
  const list = await service.devices(a);
  expect(list.devices).toHaveLength(1);
  expect(Object.keys(list.devices[0]!).sort()).toEqual(['id', 'platform', 'registeredAt', 'revision']);
  expect(JSON.stringify(list)).not.toMatch(/ExpoPushToken|secret_hash|owner_id/);
  await database.pool.query('UPDATE push_installations SET enabled=false WHERE owner_id=$1', [a.id]);
  expect(await service.devices(a)).toEqual({ devices: [] });
});
test('remote revocation requires ownership and revision, supports exact retries and removes the device from the list', async () => {
  const update = input();
  await service.register(a, update);
  const device = (await service.devices(a)).devices[0]!;
  const revoke = { expectedRevision: device.revision, mutationId: randomUUID() };
  await expect(service.revokeDevice(b, device.id, revoke)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const first = await service.revokeDevice(a, device.id, revoke);
  expect(first).toEqual({ id: device.id, revision: 2, enabled: false });
  expect(await service.revokeDevice(a, device.id, revoke)).toEqual(first);
  expect(await service.devices(a)).toEqual({ devices: [] });
  await service.register(a, { ...update, expectedRevision: 2, mutationId: randomUUID() });
  await expect(service.revokeDevice(a, device.id, revoke)).rejects.toMatchObject({
    code: 'PUSH_REGISTRATION_CHANGED',
  });
  expect((await service.devices(a)).devices[0]?.revision).toBe(3);
});
test('disabled users and account transfers fence old remote revocations', async () => {
  const update = input();
  await service.register(a, update);
  const device = (await service.devices(a)).devices[0]!;
  const revoke = { expectedRevision: 1, mutationId: randomUUID() };
  await database.pool.query('UPDATE users SET disabled=true WHERE id=$1', [a.id]);
  await expect(service.revokeDevice(a, device.id, revoke)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await database.pool.query('UPDATE users SET disabled=false WHERE id=$1', [a.id]);
  await service.register(b, { ...update, expectedRevision: 1, mutationId: randomUUID() });
  await expect(service.revokeDevice(a, device.id, revoke)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await service.devices(b)).devices).toHaveLength(1);
});
