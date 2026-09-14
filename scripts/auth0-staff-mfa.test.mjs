import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onExecutePostLogin } from './auth0-staff-mfa.cjs';

test('staff-only flow enrolls or challenges OTP and cannot refresh past the challenge', async () => {
  const base = {
    secrets: { ROVE_STAFF_CLIENT_ID: 'staff-client', ROVE_API_AUDIENCE: 'rove-api' },
    client: { client_id: 'staff-client' },
    resource_server: { identifier: 'rove-api' },
    user: {},
  };
  const run = async (event) => {
    const calls = [];
    await onExecutePostLogin(event, {
      access: { deny: () => calls.push('deny') },
      authentication: {
        challengeWith: (factor) => calls.push(['challenge', factor]),
        enrollWith: (factor) => calls.push(['enroll', factor]),
      },
    });
    return calls;
  };
  assert.deepEqual(await run(base), [['enroll', { type: 'otp' }]]);
  assert.deepEqual(await run({ ...base, user: { enrolledFactors: [{ type: 'otp' }] } }), [
    ['challenge', { type: 'otp' }],
  ]);
  assert.deepEqual(await run({ ...base, user: { enrolledFactors: [{ type: 'phone' }] } }), [
    ['enroll', { type: 'otp' }],
  ]);
  for (const client_id of ['rider', 'driver', undefined]) {
    assert.deepEqual(await run({ ...base, client: { client_id } }), []);
  }
  assert.deepEqual(await run({ ...base, secrets: {} }), []);
  assert.deepEqual(await run({ ...base, resource_server: { identifier: 'other' } }), ['deny']);
  assert.deepEqual(await run({ ...base, secrets: { ROVE_STAFF_CLIENT_ID: 'staff-client' } }), ['deny']);
  assert.deepEqual(await run({ ...base, transaction: { protocol: 'oauth2-refresh-token' } }), ['deny']);
});
