import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onExecutePostLogin } from './auth0-mfa-claim.cjs';

test('MFA claim uses completed authentication evidence only for the configured audience', async () => {
  const base = { secrets: { ROVE_API_AUDIENCE: 'rove-api' }, resource_server: { identifier: 'rove-api' } };
  const run = async (event) => {
    const claims = [];
    await onExecutePostLogin(event, { accessToken: { setCustomClaim: (...args) => claims.push(args) } });
    return claims;
  };
  for (const methods of [
    undefined,
    [],
    [{ name: 'pwd' }],
    [{ name: 'otp' }],
    [{ name: 'MFA' }],
    'mfa',
    [null],
  ]) {
    assert.deepEqual(
      await run({ ...base, authentication: { methods }, user: { user_metadata: { mfa: true } } }),
      [['https://roveride.co/mfa', false]],
    );
  }
  assert.deepEqual(await run({ ...base, authentication: { methods: [{ name: 'pwd' }, { name: 'mfa' }] } }), [
    ['https://roveride.co/mfa', true],
  ]);
  assert.deepEqual(await run({ ...base, resource_server: { identifier: 'other' } }), []);
  assert.deepEqual(await run({ ...base, secrets: {} }), []);
});
