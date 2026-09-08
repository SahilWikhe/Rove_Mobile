import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { PushRegistration } from './push-registration';
const journals = new Map<string, Promise<PushRegistration>>();
export function pushRegistration(apiUrl: string, projectId: string) {
  const scope = JSON.stringify([apiUrl, projectId]);
  let journal = journals.get(scope);
  if (!journal) {
    journal = (async () => {
      const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope);
      const key = `rove.push.${digest}`;
      const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
      return new PushRegistration(
        {
          read: () => SecureStore.getItemAsync(key, options),
          write: (value) => SecureStore.setItemAsync(key, value, options),
        },
        () => ({ installationId: Crypto.randomUUID(), secret: secret32() }),
        () => Crypto.randomUUID(),
      );
    })();
    journals.set(scope, journal);
    void journal.catch(() => journals.delete(scope));
  }
  return journal;
}
function secret32() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = Crypto.getRandomBytes(32);
  let bits = 0,
    value = 0,
    result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      result += alphabet[(value >>> bits) & 63];
    }
  }
  if (bits) result += alphabet[(value << (6 - bits)) & 63];
  return result;
}
