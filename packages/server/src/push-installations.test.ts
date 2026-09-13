import { actorTransaction } from './actor-transaction';
import { transaction } from './transactions';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { users } from '@rove/database';
import { PushInstallations } from './push-installations';
let runtimePool: Pool;
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
  await database.pool.query(
    "CREATE ROLE rls_installations LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'synthetic-local-only'",
  );
  await database.pool.query('GRANT USAGE ON SCHEMA public TO rls_installations');
  await database.pool.query(
    'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rls_installations',
  );
  runtimePool = new Pool({
    host: '127.0.0.1',
    port: (await database.pool.query('SELECT inet_server_port() AS port')).rows[0].port,
    database: 'postgres',
    user: 'rls_installations',
    password: 'synthetic-local-only',
    max: 5,
  });
  service = new PushInstallations(runtimePool, projects);
}, 60000);
afterAll(async () => {
  await runtimePool?.end();
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

test('account revocation frees a lost-proof token for new identity without letting old work revoke it', async () => {
  const old = input();
  await service.register(a, old);
  const listed = await service.devices(a);
  const device = listed.devices[0]!;
  await expect(
    service.revokeDevice(b, device.id, { expectedRevision: device.revision, mutationId: randomUUID() }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await service.devices(a)).devices).toHaveLength(1);
  await service.revokeDevice(a, device.id, { expectedRevision: device.revision, mutationId: randomUUID() });
  expect((await service.devices(a)).devices).toHaveLength(0);
  const fresh = { ...input(), token: old.token };
  expect(await service.register(a, fresh)).toMatchObject({ enabled: true, revision: 1 });
  await expect(
    service.register(a, { ...old, expectedRevision: 2, mutationId: randomUUID() }),
  ).rejects.toMatchObject({ code: 'PUSH_REGISTRATION_CHANGED' });
  await expect(
    service.remove(a, {
      installationId: old.installationId,
      secret: old.secret,
      expectedRevision: 1,
      mutationId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'PUSH_REGISTRATION_CHANGED' });
  expect(
    await service.status(a, { installationId: fresh.installationId, secret: fresh.secret }),
  ).toMatchObject({ enabled: true, revision: 1 });
});

test('installation reads require an active verified actor and transaction identity does not leak', async () => {
  const update = input();
  await service.register(a, update);
  await expect(service.devices({ ...a, role: 'driver' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(service.devices({ id: randomUUID(), role: 'rider' })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await database.pool.query('UPDATE users SET disabled=true WHERE id=$1', [a.id]);
  await expect(service.devices(a)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    service.status(a, { installationId: update.installationId, secret: update.secret }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const c = await runtimePool.connect();
  try {
    expect(
      (await c.query("SELECT NULLIF(current_setting('rove.actor_id',true),'') AS actor")).rows[0].actor,
    ).toBeNull();
  } finally {
    c.release();
  }
});

test('installation policies isolate owners and make audience scope read only', async () => {
  const first = input(),
    second = input();
  await service.register(a, first);
  await service.register(b, second);
  const rows = (await database.pool.query('SELECT id,owner_id,revision FROM push_installations ORDER BY id'))
    .rows;
  const foreign = rows.find((r) => r.owner_id === b.id)!;
  expect((await runtimePool.query('SELECT * FROM push_installations')).rowCount).toBe(0);
  await actorTransaction(runtimePool, a, async (c) => {
    expect((await c.query('SELECT * FROM push_installations')).rowCount).toBe(1);
    expect(
      (await c.query('UPDATE push_installations SET enabled=false WHERE id=$1', [foreign.id])).rowCount,
    ).toBe(0);
    expect((await c.query('DELETE FROM push_installations')).rowCount).toBe(0);
  });
  await expect(
    actorTransaction(runtimePool, a, (c) => c.query('UPDATE push_installations SET owner_id=$1', [b.id])),
  ).rejects.toMatchObject({ code: '42501' });
  await transaction(runtimePool, async (c) => {
    await c.query(
      "SELECT set_config('rove.audience_rider',$1,true),set_config('rove.audience_rider_project',$2,true)",
      [a.id, projects.rider],
    );
    expect((await c.query('SELECT * FROM push_installations')).rowCount).toBe(1);
    expect((await c.query('UPDATE push_installations SET enabled=false')).rowCount).toBe(0);
  });
  await transaction(runtimePool, async (c) => {
    await c.query(
      "SELECT set_config('rove.install_target',$1,true),set_config('rove.install_revision',$2,true)",
      [foreign.id, String(foreign.revision + 1)],
    );
    expect((await c.query('UPDATE push_installations SET enabled=false,revision=revision+1')).rowCount).toBe(
      0,
    );
  });
  expect((await runtimePool.query('SELECT * FROM push_installations')).rowCount).toBe(0);
});
