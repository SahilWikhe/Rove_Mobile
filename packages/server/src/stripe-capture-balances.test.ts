import { expect, test, vi } from 'vitest';
import { StripeCaptureBalances, type CaptureBalanceClient } from './stripe-capture-balances';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const reference = {
  operationId: uuid(1),
  firstAttemptAt: new Date(1789200000000).toISOString(),
  driverId: uuid(2),
  bindingId: uuid(3),
  accountId: 'acct_driver',
  chargeId: 'ch_fare',
  amountCents: 800,
  payment: {
    intentId: 'pi_fare',
    rideId: uuid(4),
    attemptId: uuid(5),
    customerId: 'cus_rider',
    amountCents: 1000,
  },
};
function balance(source: string, amount: number, type: string) {
  return {
    id: `txn_${source.replaceAll('_', '')}`,
    object: 'balance_transaction',
    source,
    currency: 'usd',
    amount,
    fee: 0,
    net: amount,
    type,
    status: 'available',
  };
}
function setup() {
  const charge = {
    id: reference.chargeId,
    object: 'charge',
    livemode: false,
    payment_intent: 'pi_fare',
    paid: true,
    captured: true,
    status: 'succeeded',
    currency: 'usd',
    amount: 1000,
    amount_captured: 1000,
    amount_refunded: 0,
    disputed: false,
    balance_transaction: balance('ch_fare', 1000, 'charge'),
  };
  const intent = {
    id: 'pi_fare',
    object: 'payment_intent',
    livemode: false,
    amount: 1000,
    amount_received: 1000,
    amount_capturable: 0,
    capture_method: 'manual',
    transfer_data: null,
    on_behalf_of: null,
    application_fee_amount: null,
    status: 'succeeded',
    currency: 'usd',
    customer: 'cus_rider',
    metadata: { roveRideId: uuid(4), roveAttemptId: uuid(5) },
    latest_charge: charge,
  };

  charge.balance_transaction.fee = 59;
  charge.balance_transaction.net = 941;
  const account = vi.fn().mockResolvedValue({ id: 'acct_platform', object: 'account' });
  const payment = vi.fn().mockResolvedValue(intent);
  const client = {
    accounts: { retrieve: account },
    paymentIntents: { retrieve: payment },
  } as unknown as CaptureBalanceClient;
  const provider = new StripeCaptureBalances(
    { secretKey: 'rk_test_fixture', live: false, platformAccountId: 'acct_platform' },
    client,
  );
  return { provider, charge, intent, account, payment };
}
const unavailable = { code: 'CAPTURE_BALANCE_UNAVAILABLE' };
test('reads the original capture fee and net using an expanded, source-verified platform request', async () => {
  const s = setup();
  expect(await s.provider.retrieve(reference.payment)).toEqual({
    chargeId: 'ch_fare',
    balanceId: 'txn_chfare',
    amountCents: 1000,
    feeCents: 59,
    netCents: 941,
    status: 'available',
    disputed: false,
    unrefundedCents: 1000,
  });
  expect(s.account).toHaveBeenCalledWith(null);
  expect(s.payment).toHaveBeenCalledWith('pi_fare', { expand: ['latest_charge.balance_transaction'] });
});
test('keeps original processing fees distinct from later refund and dispute movements', async () => {
  const s = setup();
  s.charge.amount_refunded = 400;
  s.charge.disputed = true;
  expect(await s.provider.retrieve(reference.payment)).toMatchObject({
    amountCents: 1000,
    feeCents: 59,
    netCents: 941,
    disputed: true,
    unrefundedCents: 600,
  });
});
test('reports pending balance and explicit zero fee without treating missing fee as zero', async () => {
  const s = setup();
  s.charge.balance_transaction.status = 'pending';
  s.charge.balance_transaction.fee = 0;
  s.charge.balance_transaction.net = 1000;
  expect(await s.provider.retrieve(reference.payment)).toMatchObject({
    status: 'pending',
    feeCents: 0,
    netCents: 1000,
  });
  Reflect.deleteProperty(s.charge.balance_transaction, 'fee');
  await expect(s.provider.retrieve(reference.payment)).rejects.toMatchObject(unavailable);
});
test.each([
  ['intent', 'id', 'pi_other'],
  ['intent', 'customer', 'cus_other'],
  ['intent', 'livemode', true],
  ['intent', 'amount_received', 999],
  ['intent', 'capture_method', 'automatic'],
  ['intent', 'transfer_data', { destination: 'acct_other' }],
  ['intent', 'on_behalf_of', 'acct_other'],
  ['intent', 'application_fee_amount', 20],
  ['intent', 'latest_charge', null],
  ['intent', 'metadata', { roveRideId: uuid(9), roveAttemptId: uuid(5) }],
  ['charge', 'payment_intent', 'pi_other'],
  ['charge', 'livemode', true],
  ['charge', 'amount_captured', 999],
  ['charge', 'amount_refunded', 1001],
  ['charge', 'balance_transaction', null],
  ['charge', 'balance_transaction', 'txn_unexpanded'],
  ['balance', 'source', 'ch_other'],
  ['balance', 'currency', 'eur'],
  ['balance', 'net', 940],
  ['balance', 'type', 'refund'],
  ['balance', 'status', 'unknown'],
])('rejects incompatible or uncorrelated capture %s.%s', async (target, field, value) => {
  const s = setup();
  const record =
    target === 'intent' ? s.intent : target === 'charge' ? s.charge : s.charge.balance_transaction;
  Reflect.set(record, field, value);
  await expect(s.provider.retrieve(reference.payment)).rejects.toMatchObject(unavailable);
});
test.each([-1, 1001, 1.5])(
  'rejects invalid actual capture fee %s even with matching arithmetic',
  async (fee) => {
    const s = setup();
    s.charge.balance_transaction.fee = fee;
    s.charge.balance_transaction.net = 1000 - fee;
    await expect(s.provider.retrieve(reference.payment)).rejects.toMatchObject(unavailable);
  },
);
test('rejects the wrong platform before fetching payment data and sanitizes provider failures', async () => {
  const s = setup();
  s.account.mockResolvedValue({ id: 'acct_other', object: 'account' });
  await expect(s.provider.retrieve(reference.payment)).rejects.toMatchObject(unavailable);
  expect(s.payment).not.toHaveBeenCalled();
  s.account.mockRejectedValue(new Error('private-provider-response'));
  await expect(s.provider.retrieve(reference.payment)).rejects.toThrow(
    'Captured payment balance could not be verified.',
  );
});
