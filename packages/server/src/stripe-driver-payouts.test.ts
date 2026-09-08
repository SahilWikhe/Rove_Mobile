import { expect, test, vi } from 'vitest';
import { StripeDriverPayouts, type ConnectClient } from './stripe-driver-payouts';
const reference = {
  driverId: '00000000-0000-4000-8000-000000000001',
  bindingId: '00000000-0000-4000-8000-000000000002',
};
function setup() {
  const account = {
    id: 'acct_fixture',
    object: 'v2.core.account',
    livemode: false,
    metadata: { roveDriverId: reference.driverId, roveBindingId: reference.bindingId },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: { stripe_transfers: { status: 'active' }, payouts: { status: 'active' } },
        },
      },
    },
  };
  const create = vi.fn().mockResolvedValue(account),
    retrieve = vi.fn().mockResolvedValue(account);
  const link = vi.fn().mockResolvedValue({
    account: account.id,
    livemode: false,
    url: 'https://accounts.stripe.com/r/fixture#single-use',
    expires_at: '2026-09-08T12:10:00Z',
  });
  const client = {
    accounts: { create, retrieve },
    accountLinks: { create: link },
  } as unknown as ConnectClient;
  const provider = new StripeDriverPayouts(
    { secretKey: 'rk_test_fixture', live: false, origin: 'https://api.example.test' },
    client,
  );
  return { provider, account, create, retrieve, link };
}
test('creates v2 recipient account with stable metadata and explicit platform responsibilities', async () => {
  const { provider, create } = setup();
  expect(await provider.createAccount(reference, 'rove:fixture:key')).toBe('acct_fixture');
  expect(create.mock.calls[0]?.[0]).toMatchObject({
    dashboard: 'express',
    identity: { country: 'us' },
    defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
    configuration: {
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
    },
  });
  expect(create.mock.calls[0]?.[0]).not.toHaveProperty('type');
  expect(create.mock.calls[0]?.[1]).toEqual({ idempotencyKey: 'rove:fixture:key' });
});
test('checks both v2 transfer and payout capabilities; unknown or inactive capabilities never imply readiness', async () => {
  const { provider, account } = setup();
  expect(await provider.status({ ...reference, accountId: account.id })).toBe('ready');
  account.configuration.recipient.capabilities.stripe_balance.payouts.status = 'pending';
  expect(await provider.status({ ...reference, accountId: account.id })).toBe('pending');
  account.configuration.recipient.capabilities.stripe_balance.payouts.status = 'active';
  account.configuration.recipient.capabilities.stripe_balance.stripe_transfers.status = 'restricted';
  expect(await provider.status({ ...reference, accountId: account.id })).toBe('needs_information');
});
test('rejects different account, owner, binding or mode and strips provider error details', async () => {
  for (const mutate of [
    (a: ReturnType<typeof setup>['account']) => {
      a.id = 'acct_other';
    },
    (a: ReturnType<typeof setup>['account']) => {
      a.livemode = true;
    },
    (a: ReturnType<typeof setup>['account']) => {
      a.metadata.roveDriverId = reference.bindingId;
    },
    (a: ReturnType<typeof setup>['account']) => {
      a.metadata.roveBindingId = reference.driverId;
    },
  ]) {
    const { provider, account } = setup();
    mutate(account);
    await expect(provider.status({ ...reference, accountId: 'acct_fixture' })).rejects.toMatchObject({
      code: 'PAYOUT_PROVIDER_UNAVAILABLE',
    });
  }
  const { provider, retrieve } = setup();
  retrieve.mockRejectedValue(new Error('PRIVATE_PROVIDER_DETAIL'));
  await expect(provider.status({ ...reference, accountId: 'acct_fixture' })).rejects.not.toThrow(
    'PRIVATE_PROVIDER_DETAIL',
  );
});
test('one-use links must match the account/mode and point only at Stripe HTTPS hosts', async () => {
  const { provider, link } = setup();
  const result = await provider.onboardingLink('acct_fixture');
  expect(result.url).toContain('accounts.stripe.com');
  expect(link.mock.calls[0]?.[0].use_case.account_onboarding).toEqual({
    configurations: ['recipient'],
    refresh_url: 'https://api.example.test/connect/refresh',
    return_url: 'https://api.example.test/connect/return',
  });
  for (const url of [
    'https://accounts.stripe.com.evil.test/x',
    'http://accounts.stripe.com/x',
    'https://user:pass@accounts.stripe.com/x',
  ]) {
    link.mockResolvedValueOnce({
      account: 'acct_fixture',
      livemode: false,
      url,
      expires_at: result.expiresAt,
    });
    await expect(provider.onboardingLink('acct_fixture')).rejects.toMatchObject({ status: 503 });
  }
  link.mockResolvedValueOnce({
    account: 'acct_other',
    livemode: false,
    url: result.url,
    expires_at: result.expiresAt,
  });
  await expect(provider.onboardingLink('acct_fixture')).rejects.toMatchObject({ status: 503 });
});
