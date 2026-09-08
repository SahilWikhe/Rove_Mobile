import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { users, drivers } from '@rove/database';
import { updateProfileName } from './profiles';

let database: Awaited<ReturnType<typeof testDatabase>>;
const rider = { id: randomUUID(), role: 'rider' as const };
const driver = { id: randomUUID(), role: 'driver' as const };
const input = (name: string, expectedProfileId = rider.id) => ({
  expectedProfileId,
  expectedName: 'Original',
  name,
});
beforeAll(async () => {
  database = await testDatabase();
}, 60_000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  await database.db
    .insert(users)
    .values([rider, driver].map((actor) => ({ ...actor, subject: actor.id, name: 'Original' })));
  await database.db.insert(drivers).values({ id: driver.id });
});
test('riders and drivers can update only their own displayed names', async () => {
  expect(await updateProfileName(database.pool, rider, input('  Amélie 王  '))).toEqual({
    ...rider,
    name: 'Amélie 王',
  });
  expect((await database.pool.query('SELECT name FROM users WHERE id=$1', [driver.id])).rows[0].name).toBe(
    'Original',
  );
  expect(await updateProfileName(database.pool, driver, input('Driver name', driver.id))).toEqual({
    ...driver,
    name: 'Driver name',
  });
  expect((await database.pool.query('SELECT approved,payout_ready FROM drivers')).rows[0]).toEqual({
    approved: false,
    payout_ready: false,
  });
});
test('strict input rejects identity, approval, role and malformed name changes', async () => {
  for (const invalid of [
    { ...input('Changed'), role: 'staff' },
    { ...input('Changed'), approved: true },
    { ...input('Changed'), subject: 'someone-else' },
    input(''),
    input(' '.repeat(4)),
    input('x'.repeat(101)),
    input('A\u0000B'),
    input('A\nB'),
  ])
    await expect(updateProfileName(database.pool, rider, invalid)).rejects.toMatchObject({
      code: 'INVALID_PROFILE',
    });
  expect((await database.pool.query('SELECT name FROM users WHERE id=$1', [rider.id])).rows[0].name).toBe(
    'Original',
  );
});
test('stale requests cannot edit a different signed-in account or a disabled account', async () => {
  await expect(updateProfileName(database.pool, driver, input('Other account'))).rejects.toMatchObject({
    code: 'PROFILE_CHANGED',
  });
  await database.pool.query('UPDATE users SET disabled=true WHERE id=$1', [rider.id]);
  await expect(updateProfileName(database.pool, rider, input('Disabled'))).rejects.toMatchObject({
    code: 'PROFILE_CHANGED',
  });
  await expect(
    updateProfileName(database.pool, { ...rider, role: 'staff' }, input('Staff')),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
test('concurrent different edits cannot silently overwrite each other', async () => {
  const edits = await Promise.allSettled(
    ['First', 'Second'].map((name) => updateProfileName(database.pool, rider, input(name))),
  );
  expect(edits.filter((edit) => edit.status === 'fulfilled')).toHaveLength(1);
  const rejected = edits.find((edit) => edit.status === 'rejected');
  expect(rejected?.reason).toMatchObject({ code: 'PROFILE_CHANGED', status: 409 });
  const winner = (await database.pool.query('SELECT name FROM users WHERE id=$1', [rider.id])).rows[0].name;
  expect(
    await updateProfileName(database.pool, rider, { ...input('Reviewed edit'), expectedName: winner }),
  ).toMatchObject({ name: 'Reviewed edit' });
});
test('retrying a saved value is harmless but replaying over a newer edit is rejected', async () => {
  const first = await updateProfileName(database.pool, rider, input('First'));
  expect(await updateProfileName(database.pool, rider, input('First'))).toEqual(first);
  await updateProfileName(database.pool, rider, { ...input('Newer'), expectedName: 'First' });
  await expect(updateProfileName(database.pool, rider, input('First'))).rejects.toMatchObject({
    code: 'PROFILE_CHANGED',
  });
});
