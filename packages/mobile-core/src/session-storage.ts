export interface SessionScope {
  apiUrl: string;
  issuer: string;
  clientId: string;
  audience: string;
  role: 'rider' | 'driver';
  synthetic: boolean;
}
interface Storage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Bind credentials to the exact deployment/identity configuration; never import legacy global keys. */
export function createScopedSessionStorage(
  scope: SessionScope,
  digest: (value: string) => Promise<string>,
  storage: Storage,
) {
  const identity = JSON.stringify([
    scope.apiUrl,
    scope.issuer,
    scope.clientId,
    scope.audience,
    scope.role,
    scope.synthetic,
  ]);
  // Hash lazily so unsupported storage/crypto on a web preview does not run during rendering.
  const key = async () => {
    const hash = await digest(identity);
    if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Unable to scope saved session.');
    return `rove.session.v2.${hash}`;
  };
  return {
    read: async () => storage.read(await key()),
    write: async (value: string) => storage.write(await key(), value),
    remove: async () => storage.remove(await key()),
  };
}
