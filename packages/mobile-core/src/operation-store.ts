import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { OperationJournal } from './operations';
// Separate from auth credentials. Entries contain operation identifiers, never addresses/card data.
const journals = new Map<string, Promise<OperationJournal>>();
export function operationJournal(apiUrl: string, accountId: string, synthetic: boolean) {
  const scope = JSON.stringify([apiUrl, accountId, synthetic]);
  let journal = journals.get(scope);
  if (!journal) {
    journal = (async () => {
      const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope);
      const key = `rove.operation.${digest}`;
      const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
      return new OperationJournal(
        {
          read: async () =>
            Platform.OS === 'web' ? sessionStorage.getItem(key) : SecureStore.getItemAsync(key, options),
          write: async (value) => {
            if (Platform.OS === 'web') sessionStorage.setItem(key, value);
            else await SecureStore.setItemAsync(key, value, options);
          },
          clear: async () => {
            if (Platform.OS === 'web') sessionStorage.removeItem(key);
            else await SecureStore.deleteItemAsync(key, options);
          },
        },
        () => Crypto.randomUUID(),
      );
    })();
    journals.set(scope, journal);
    void journal.catch(() => journals.delete(scope));
  }
  return journal;
}
