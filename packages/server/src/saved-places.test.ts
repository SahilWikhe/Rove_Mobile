import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { users } from '@rove/database';
import { SavedPlaceService } from './saved-places';
import type { MapsProvider } from './quotes';
let database: Awaited<ReturnType<typeof testDatabase>>;
const resolve = vi.fn(async (id: string) => ({
  id,
  label: 'Current provider address',
  area: 'Synthetic',
  coordinate: { latitude: 35.8, longitude: -78.6 },
}));
const maps: MapsProvider = {
  resolve,
  search: async () => [],
  route: async () => ({ distanceMeters: 1, durationSeconds: 1 }),
};
let service: SavedPlaceService;
let a: { id: string; role: 'rider' }, b: { id: string; role: 'rider' };
beforeAll(async () => {
  database = await testDatabase();
  service = new SavedPlaceService(database.pool, maps);
}, 60000);
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  resolve.mockClear();
  a = { id: randomUUID(), role: 'rider' };
  b = { id: randomUUID(), role: 'rider' };
  await database.db
    .insert(users)
    .values([a, b].map((actor) => ({ ...actor, subject: actor.id, name: 'Synthetic rider' })));
});
test('saved IDs are private to the rider and resolve current details only when used', async () => {
  await service.update(a, 'home', 'provider-a', null);
  expect(await service.list(a)).toEqual({ places: [{ kind: 'home', placeId: 'provider-a' }] });
  expect(await service.list(b)).toEqual({ places: [] });
  await expect(service.resolve(b, 'home')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(await service.resolve(a, 'home')).toMatchObject({
    id: 'provider-a',
    label: 'Current provider address',
  });
  const stored = (await database.pool.query('SELECT * FROM saved_places')).rows[0];
  expect(Object.keys(stored).sort()).toEqual(['id', 'kind', 'place_id', 'rider_id']);
});
test('concurrent first saves cannot overwrite one another', async () => {
  const result = await Promise.allSettled([
    service.update(a, 'home', 'first', null),
    service.update(a, 'home', 'second', null),
  ]);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(result.find((r) => r.status === 'rejected')).toMatchObject({
    reason: { code: 'SAVED_PLACE_CHANGED' },
  });
  expect((await service.list(a)).places).toHaveLength(1);
});
test('retries are safe and stale replacements or deletions do not erase a newer place', async () => {
  await service.update(a, 'work', 'first', null);
  await service.update(a, 'work', 'first', null);
  await service.update(a, 'work', 'second', 'first');
  await expect(service.update(a, 'work', 'third', 'first')).rejects.toMatchObject({
    code: 'SAVED_PLACE_CHANGED',
  });
  await expect(service.remove(a, 'work', 'first')).rejects.toMatchObject({ code: 'SAVED_PLACE_CHANGED' });
  expect((await service.list(a)).places[0]?.placeId).toBe('second');
  await service.remove(a, 'work', 'second');
  await service.remove(a, 'work', 'second');
  expect(await service.list(a)).toEqual({ places: [] });
});
test('a provider failure cannot replace an existing place', async () => {
  await service.update(a, 'home', 'first', null);
  resolve.mockRejectedValueOnce(new Error('provider unavailable'));
  await expect(service.update(a, 'home', 'second', 'first')).rejects.toThrow('provider unavailable');
  expect((await service.list(a)).places[0]?.placeId).toBe('first');
});
test('driver and staff operations are rejected before calling the provider', async () => {
  for (const role of ['driver', 'staff'] as const) {
    const actor = { id: a.id, role };
    await expect(service.list(actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.update(actor, 'home', 'secret', null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.resolve(actor, 'home')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.remove(actor, 'home', 'secret')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }
  expect(resolve).not.toHaveBeenCalled();
});
test('disabling the owner while resolution is in flight prevents persistence', async () => {
  resolve.mockImplementationOnce(async (id) => {
    await database.pool.query('UPDATE users SET disabled=true WHERE id=$1', [a.id]);
    return { id, label: 'Synthetic', area: 'Synthetic', coordinate: { latitude: 35.8, longitude: -78.6 } };
  });
  await expect(service.update(a, 'home', 'place', null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await database.pool.query('SELECT id FROM saved_places')).rowCount).toBe(0);
});
