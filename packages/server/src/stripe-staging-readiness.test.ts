import { expect, test, vi } from 'vitest';
import { inspectStripeStaging } from './stripe-staging-readiness';

const env = {
  ROVE_ENVIRONMENT: 'staging',
  STRIPE_SECRET_KEY: 'rk_test_fixture',
  STRIPE_ACCOUNT_ID: 'acct_fixture',
  STRIPE_PAYMENT_METHOD_CONFIGURATION: 'pmc_fixture',
};
function fixture() {
  const account = vi.fn(async () => ({ id: 'acct_fixture' }));
  const configuration = vi.fn(async () => ({
    id: 'pmc_fixture',
    active: true,
    livemode: false,
    card: { available: true, display_preference: { value: 'on' } },
  }));
  const reader = vi.fn(() => ({ account, configuration }));
  return { account, configuration, reader };
}
test('verifies the expected sandbox and active card configuration without returning credentials', async () => {
  const f = fixture();
  expect(await inspectStripeStaging(env, f.reader)).toEqual({
    accountId: 'acct_fixture',
    configurationId: 'pmc_fixture',
  });
  expect(f.configuration).toHaveBeenCalledWith('pmc_fixture');
});
test.each([
  { ROVE_ENVIRONMENT: 'production' },
  { STRIPE_SECRET_KEY: 'sk_live_fixture' },
  { STRIPE_SECRET_KEY: undefined },
  { STRIPE_ACCOUNT_ID: undefined },
  { STRIPE_PAYMENT_METHOD_CONFIGURATION: '' },
])('rejects unsafe or incomplete settings before opening the provider client: %j', async (override) => {
  const f = fixture();
  await expect(inspectStripeStaging({ ...env, ...override }, f.reader)).rejects.toThrow(
    'Invalid Stripe staging settings.',
  );
  expect(f.reader).not.toHaveBeenCalled();
});
test('rejects a different account before reading its configuration', async () => {
  const f = fixture();
  f.account.mockResolvedValue({ id: 'acct_other' });
  await expect(inspectStripeStaging(env, f.reader)).rejects.toThrow('verification failed');
  expect(f.configuration).not.toHaveBeenCalled();
});
test.each([
  { id: 'pmc_other' },
  { active: false },
  { livemode: true },
  { card: { available: false, display_preference: { value: 'on' } } },
  { card: { available: true, display_preference: { value: 'off' } } },
])('rejects unusable payment configuration: %j', async (override) => {
  const f = fixture();
  const base = await f.configuration();
  f.configuration.mockResolvedValue({ ...base, ...override });
  await expect(inspectStripeStaging(env, f.reader)).rejects.toThrow('verification failed');
});
test('suppresses raw provider errors', async () => {
  const f = fixture();
  f.account.mockRejectedValue(new Error('private credentials and provider response'));
  await expect(inspectStripeStaging(env, f.reader)).rejects.toThrow(/^Stripe staging verification failed\./);
});
