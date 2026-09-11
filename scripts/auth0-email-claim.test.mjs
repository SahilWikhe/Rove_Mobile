import { test } from 'node:test';
import assert from 'node:assert/strict';
import action from './auth0-email-claim.cjs';

test('email claim uses provider verification rather than editable metadata and is audience scoped', async () => {
  for (const value of [undefined, false, 'true', 1, true]) {
    const claims = [];
    await action.onExecutePostLogin(
      {
        secrets: { ROVE_API_AUDIENCE: 'rove-api' },
        resource_server: { identifier: 'rove-api' },
        user: { email_verified: value, user_metadata: { email_verified: true } },
      },
      { accessToken: { setCustomClaim: (...args) => claims.push(args) } },
    );
    assert.deepEqual(claims, [['https://roveride.co/email_verified', value === true]]);
  }
  for (const event of [
    { secrets: {}, user: {} },
    {
      secrets: { ROVE_API_AUDIENCE: 'rove-api' },
      resource_server: { identifier: 'another-api' },
      user: { email_verified: true },
    },
  ]) {
    await action.onExecutePostLogin(event, {
      accessToken: { setCustomClaim: () => assert.fail('unrelated audience') },
    });
  }
});
