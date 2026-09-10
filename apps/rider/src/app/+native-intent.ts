import { nativeAuthIntent } from '@rove/mobile-core/native-auth-intent';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return nativeAuthIntent(path, 'rove-rider');
}
