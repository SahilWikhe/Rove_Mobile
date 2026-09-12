import { expect, test, vi } from 'vitest';
import { StripeBankPayouts, type BankPayoutClient } from './stripe-bank-payouts';
const ref = {
  driverId: '00000000-0000-4000-8000-000000000001',
  bindingId: '00000000-0000-4000-8000-000000000002',
  accountId: 'acct_driver',
};
function setup() {
  const payout = {
    id: 'po_one',
    object: 'payout',
    livemode: false,
    amount: 1200,
    currency: 'usd',
    status: 'pending',
    created: 1789200000,
    arrival_date: 1789400000,
    type: 'bank_account',
    destination: 'ba_private',
    failure_message: 'private bank details',
    metadata: { private: 'private' },
  };
  const page = { object: 'list', url: '/v1/payouts', has_more: false, data: [payout] };
  const platform = vi.fn().mockResolvedValue({ id: 'acct_platform', object: 'account' }),
    status = vi.fn().mockResolvedValue('needs_information'),
    list = vi.fn().mockResolvedValue(page);
  const provider = new StripeBankPayouts(
    { secretKey: 'rk_test_fixture', live: false, platformAccountId: 'acct_platform' },
    { status },
    { accounts: { retrieve: platform }, payouts: { list } } as unknown as BankPayoutClient,
    () => new Date(1789201000000),
  );
  return { provider, payout, page, platform, status, list };
}
test('reads only the verified connected account and exposes a minimal payout projection', async () => {
  const s = setup();
  const page = await s.provider.list(ref);
  expect(s.status).toHaveBeenCalledWith(ref);
  expect(s.list).toHaveBeenCalledWith({ limit: 20 }, { stripeAccount: 'acct_driver' });
  expect(page.items[0]).toMatchObject({
    id: 'po_one',
    amountCents: 1200,
    status: 'pending',
    destinationType: 'bank_account',
  });
  expect(JSON.stringify(page)).not.toMatch(/ba_private|private|metadata|failure_message/);
  expect(page.nextCursor).toBeNull();
});
test('paginates within the same account and retains failed status after a previously paid payout', async () => {
  const s = setup();
  s.page.has_more = true;
  s.payout.status = 'paid';
  expect((await s.provider.list(ref)).nextCursor).toBe('po_one');
  s.payout.id = 'po_older';
  s.payout.status = 'failed';
  s.page.has_more = false;
  expect((await s.provider.list(ref, 'po_one')).items[0]?.status).toBe('failed');
  expect(s.list).toHaveBeenLastCalledWith(
    { limit: 20, starting_after: 'po_one' },
    { stripeAccount: 'acct_driver' },
  );
});
test.each([
  { livemode: true },
  { currency: 'eur' },
  { amount: 0 },
  { status: 'unknown' },
  { created: 1789300000 },
  { type: 'unknown' },
])('rejects malformed or incompatible payout %j', async (change) => {
  const s = setup();
  Object.assign(s.payout, change);
  await expect(s.provider.list(ref)).rejects.toMatchObject({ code: 'BANK_PAYOUT_PROVIDER_UNAVAILABLE' });
});
test('rejects account ownership failures before list and strips provider error details', async () => {
  const s = setup();
  s.status.mockRejectedValue(new Error('private-provider-error'));
  await expect(s.provider.list(ref)).rejects.toThrow('Bank payout history could not be verified. Try again.');
  expect(s.list).not.toHaveBeenCalled();
  s.platform.mockResolvedValue({ id: 'acct_wrong', object: 'account' });
  await expect(s.provider.list(ref)).rejects.toMatchObject({ code: 'BANK_PAYOUT_PROVIDER_UNAVAILABLE' });
});
test('rejects duplicate rows, inconsistent pagination and wrong platform destination', async () => {
  const s = setup();
  s.page.data.push(s.payout);
  await expect(s.provider.list(ref)).rejects.toMatchObject({ code: 'BANK_PAYOUT_PROVIDER_UNAVAILABLE' });
  s.page.data = [];
  s.page.has_more = true;
  await expect(s.provider.list(ref)).rejects.toMatchObject({ code: 'BANK_PAYOUT_PROVIDER_UNAVAILABLE' });
  await expect(s.provider.list({ ...ref, accountId: 'acct_platform' })).rejects.toMatchObject({
    code: 'BANK_PAYOUT_PROVIDER_UNAVAILABLE',
  });
});
