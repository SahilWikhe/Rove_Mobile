import { expect, test } from 'vitest';
import { createScopedSessionStorage, type SessionScope } from './session-storage';
const base: SessionScope = {
  apiUrl: 'https://staging.example.test',
  issuer: 'https://identity.example.test/',
  clientId: 'rider-staging',
  audience: 'rove-staging',
  role: 'rider',
  synthetic: false,
};
const digest = async (value: string) => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
test('environment and identity changes cannot restore or delete another saved session', async () => {
  const records = new Map<string, string>([['rove.rider.oidc.session.v1', 'legacy-token']]);
  const adapter = {
    read: async (key: string) => records.get(key) ?? null,
    write: async (key: string, value: string) => {
      records.set(key, value);
    },
    remove: async (key: string) => {
      records.delete(key);
    },
  };
  const original = createScopedSessionStorage(base, digest, adapter);
  expect(await original.read()).toBeNull();
  await original.write('staging-token');
  for (const changes of [
    { apiUrl: 'https://production.example.test' },
    { issuer: 'https://other.example.test/' },
    { clientId: 'new-client' },
    { audience: 'production' },
    { role: 'driver' as const },
    { synthetic: true },
  ]) {
    const other = createScopedSessionStorage({ ...base, ...changes }, digest, adapter);
    expect(await other.read()).toBeNull();
    await other.write('other-token');
    expect(await original.read()).toBe('staging-token');
    await other.remove();
    expect(await original.read()).toBe('staging-token');
  }
  expect(await createScopedSessionStorage({ ...base }, digest, adapter).read()).toBe('staging-token');
  expect([...records.keys()].filter((key) => key.startsWith('rove.session.v2.'))).toHaveLength(1);
});
test('hash failure never falls back to an unscoped credential key', async () => {
  let accessed = false;
  const store = createScopedSessionStorage(base, async () => 'invalid', {
    read: async () => {
      accessed = true;
      return 'token';
    },
    write: async () => {
      accessed = true;
    },
    remove: async () => {
      accessed = true;
    },
  });
  await expect(store.read()).rejects.toThrow('scope');
  await expect(store.write('token')).rejects.toThrow('scope');
  await expect(store.remove()).rejects.toThrow('scope');
  expect(accessed).toBe(false);
});
