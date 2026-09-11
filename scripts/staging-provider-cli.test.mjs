import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
function run(args, settings) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'packages/server/src/staging-provider-check-cli.ts', ...args],
    {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      env: { PATH: process.env.PATH, ...settings },
    },
  );
}
test('provider CLI rejects missing opt-in and production selection before provider calls', () => {
  for (const [args, settings] of [
    [[], { ROVE_ENVIRONMENT: 'staging' }],
    [['--allow-billable-requests'], { ROVE_ENVIRONMENT: 'production' }],
  ]) {
    const result = run(args, settings);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'Staging provider check failed at configuration.');
  }
});
test('provider CLI refuses a live Stripe key and never prints the supplied value', () => {
  const key = ['sk', 'live', 'notARealCredential'].join('_');
  const result = run(['--allow-billable-requests'], {
    ROVE_ENVIRONMENT: 'staging',
    STRIPE_SECRET_KEY: key,
    STRIPE_ACCOUNT_ID: 'acct_fixture',
    STRIPE_PAYMENT_METHOD_CONFIGURATION: 'pmc_fixture',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr.trim(),
    'Staging provider check failed at Stripe sandbox account and payment configuration.',
  );
  assert.ok(!result.stderr.includes(key));
});
