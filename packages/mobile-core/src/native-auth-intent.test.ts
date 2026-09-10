import { describe, expect, it } from 'vitest';
import { nativeAuthIntent } from './native-auth-intent';

describe('native auth callback navigation', () => {
  it.each(['rider', 'driver'])(
    'handles %s warm and cold callback URLs without retaining credentials',
    (role) => {
      const scheme = `rove-${role}`;
      for (const path of [
        `${scheme}://auth/callback?code=synthetic&state=synthetic`,
        `${scheme}:///auth/callback?error=access_denied#details`,
        '/auth/callback?code=synthetic',
      ])
        expect(nativeAuthIntent(path, scheme)).toBe('/');
    },
  );

  it.each([
    'rove-rider://ride?id=synthetic',
    '/account',
    'https://example.test/auth/callback?code=synthetic',
    'rove-driver://auth/callback?code=synthetic',
    'rove-rider://auth/callback/other',
    'rove-rider://user@auth/callback',
    'http://[invalid',
  ])('preserves unrelated or invalid links: %s', (path) => {
    expect(nativeAuthIntent(path, 'rove-rider')).toBe(path);
  });
});
