import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';

export async function pickDriverDocument() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/jpeg', 'image/png', 'application/pdf'],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  const nativeFile = Platform.OS === 'web' ? null : new File(asset.uri);
  const file = asset.file ?? nativeFile;
  const dispose = () => {
    if (nativeFile?.exists) nativeFile.delete();
  };
  try {
    if (
      !file ||
      file.size < 1 ||
      file.size > 10 * 1024 * 1024 ||
      !['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)
    )
      throw new Error('Choose a JPEG, PNG or PDF up to 10 MB.');
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return { file, sha256, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
