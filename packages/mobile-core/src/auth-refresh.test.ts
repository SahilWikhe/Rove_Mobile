import { expect, test } from 'vitest';
import { refreshWithRecovery, SessionRefreshUnavailable } from './auth-refresh';

test.each(['temporarily_unavailable', 'server_error', 'invalid_client', 'invalid_request', undefined])(
  'provider error %s is recoverable without exposing its description',
  async (code) => {
    const result = refreshWithRecovery(async () => {
      throw { code, description: 'sensitive provider detail' };
    });
    await expect(result).rejects.toBeInstanceOf(SessionRefreshUnavailable);
    await expect(result).rejects.toThrow('Check your connection and try again.');
  },
);
test('invalid_grant remains terminal so revoked credentials are cleared', async () => {
  const revoked = { code: 'invalid_grant' };
  await expect(
    refreshWithRecovery(async () => {
      throw revoked;
    }),
  ).rejects.toBe(revoked);
});
