import { expect, test, vi } from 'vitest';
import { StripeDriverTransfers, type TransferClient } from './stripe-driver-transfers';
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
  const transfer = {
    id: 'tr_payment',
    object: 'transfer',
    livemode: false,
    amount: 800,
    amount_reversed: 0,
    reversed: false,
    currency: 'usd',
    created: 1789200000,
    destination: 'acct_driver',
    source_transaction: 'ch_fare',
    transfer_group: `rove_transfer_${uuid(1)}`,
    metadata: {
      roveTransferOperationId: uuid(1),
      roveDriverId: uuid(2),
      roveBindingId: uuid(3),
      roveRideId: uuid(4),
      roveAttemptId: uuid(5),
    },
    balance_transaction: balance('tr_payment', -800, 'transfer'),
  };
  const account = vi.fn().mockResolvedValue({ id: 'acct_platform', object: 'account' });
  const payment = vi.fn().mockResolvedValue(intent);
  const create = vi.fn().mockResolvedValue(transfer);
  const retrieve = vi.fn().mockResolvedValue(transfer);
  const list = vi.fn().mockResolvedValue({ object: 'list', data: [transfer], has_more: false });
  const reversals = vi.fn().mockResolvedValue({ object: 'list', data: [], has_more: false });
  const status = vi.fn().mockResolvedValue('ready');
  const client = {
    accounts: { retrieve: account },
    paymentIntents: { retrieve: payment },
    transfers: { create, retrieve, list, listReversals: reversals },
  } as unknown as TransferClient;
  const now = vi.fn(() => new Date(1789200060000));
  const provider = new StripeDriverTransfers(
    { secretKey: 'rk_test_fixture', live: false, platformAccountId: 'acct_platform' },
    { status },
    client,
    now,
  );
  return {
    provider,
    charge,
    intent,
    transfer,
    account,
    payment,
    create,
    retrieve,
    list,
    reversals,
    status,
    now,
  };
}
const unavailable = { code: 'TRANSFER_PROVIDER_UNAVAILABLE' };
test('verifies settled source funding and recipient, uses one deterministic transfer request, and normalizes actual debit', async () => {
  const s = setup();
  expect(await s.provider.funding(reference.payment)).toEqual({ chargeId: 'ch_fare', unrefundedCents: 1000 });
  const first = await s.provider.create(reference);
  await s.provider.create(reference);
  expect(s.create.mock.calls[0]).toEqual(s.create.mock.calls[1]);
  expect(s.create.mock.calls[0]).toEqual([
    {
      amount: 800,
      currency: 'usd',
      destination: 'acct_driver',
      source_transaction: 'ch_fare',
      transfer_group: `rove_transfer_${uuid(1)}`,
      metadata: s.transfer.metadata,
      expand: ['balance_transaction'],
    },
    { idempotencyKey: `rove-transfer:${uuid(1)}` },
  ]);
  expect(s.status).toHaveBeenCalledWith({ driverId: uuid(2), bindingId: uuid(3), accountId: 'acct_driver' });
  expect(first).toEqual({
    id: 'tr_payment',
    created: 1789200000,
    amountCents: 800,
    reversedCents: 0,
    movements: [
      {
        id: 'txn_trpayment',
        sourceId: 'tr_payment',
        kind: 'transfer',
        amountCents: -800,
        feeCents: 0,
        netCents: -800,
      },
    ],
  });
  expect(first).not.toHaveProperty('metadata');
});
test('blocks provider mutations for unready funding or recipient and rejects mismatched payment facts', async () => {
  const mutations = [
    (s: ReturnType<typeof setup>) => {
      s.charge.balance_transaction.status = 'pending';
    },
    (s: ReturnType<typeof setup>) => {
      s.charge.disputed = true;
    },
    (s: ReturnType<typeof setup>) => {
      s.charge.amount_refunded = 201;
    },
    (s: ReturnType<typeof setup>) => {
      s.status.mockResolvedValue('needs_information');
    },
    (s: ReturnType<typeof setup>) => {
      s.intent.metadata.roveRideId = uuid(9);
    },
    (s: ReturnType<typeof setup>) => {
      s.intent.customer = 'cus_other';
    },
    (s: ReturnType<typeof setup>) => {
      s.intent.livemode = true;
    },
    (s: ReturnType<typeof setup>) => {
      s.intent.amount_received = 999;
    },
    (s: ReturnType<typeof setup>) => {
      s.charge.payment_intent = 'pi_other';
    },
    (s: ReturnType<typeof setup>) => {
      s.charge.amount_captured = 999;
    },
    (s: ReturnType<typeof setup>) => {
      s.charge.balance_transaction.source = 'ch_other';
    },
    (s: ReturnType<typeof setup>) => {
      s.charge.balance_transaction.net = 999;
    },
    (s: ReturnType<typeof setup>) => {
      s.account.mockResolvedValue({ id: 'acct_other', object: 'account' });
    },
  ];
  for (const mutate of mutations) {
    const s = setup();
    mutate(s);
    await expect(s.provider.create(reference)).rejects.toBeDefined();
    expect(s.create).not.toHaveBeenCalled();
  }
});
test('rejects malformed, platform-destination and over-fare requests before provider calls', async () => {
  for (const r of [
    { ...reference, operationId: 'bad' },
    { ...reference, accountId: 'acct_platform' },
    { ...reference, amountCents: 1001 },
    { ...reference, amountCents: -1 },
  ]) {
    const s = setup();
    await expect(s.provider.create(r)).rejects.toMatchObject(unavailable);
    expect(s.account).not.toHaveBeenCalled();
    expect(s.create).not.toHaveBeenCalled();
  }
});
test('recovers a lost response without a mutation, including when current funding/account readiness has changed', async () => {
  const s = setup();
  s.create.mockRejectedValue(new Error('PRIVATE_PROVIDER_DETAIL'));
  await expect(s.provider.create(reference)).rejects.not.toThrow('PRIVATE_PROVIDER_DETAIL');
  s.payment.mockRejectedValue(new Error('no longer eligible'));
  s.status.mockRejectedValue(new Error('disabled'));
  s.status.mockClear();
  s.payment.mockClear();
  expect((await s.provider.find(reference))?.id).toBe('tr_payment');
  expect(s.create).toHaveBeenCalledTimes(1);
  expect(s.status).not.toHaveBeenCalled();
  expect(s.payment).not.toHaveBeenCalled();
  expect(s.list).toHaveBeenCalledWith({
    destination: 'acct_driver',
    transfer_group: `rove_transfer_${uuid(1)}`,
    limit: 2,
    expand: ['data.balance_transaction'],
  });
});
test('returns null only for verified complete absence; ambiguous or partial transfer history fails closed', async () => {
  const s = setup();
  s.list.mockResolvedValueOnce({ object: 'list', data: [], has_more: false });
  expect(await s.provider.find(reference)).toBeNull();
  for (const page of [
    { object: 'list', data: [], has_more: true },
    { object: 'list', data: [s.transfer, s.transfer], has_more: false },
    { data: [] },
  ]) {
    s.list.mockResolvedValueOnce(page);
    await expect(s.provider.find(reference)).rejects.toMatchObject(unavailable);
  }
  expect(s.create).not.toHaveBeenCalled();
});
test('rejects transfer identity, mode, amount, correlation and financial mismatches', async () => {
  for (const mutate of [
    (t: ReturnType<typeof setup>['transfer']) => {
      t.id = 'tr_other';
    },
    (t: ReturnType<typeof setup>['transfer']) => {
      t.destination = 'acct_other';
    },
    (t: ReturnType<typeof setup>['transfer']) => {
      t.livemode = true;
    },
    (t: ReturnType<typeof setup>['transfer']) => {
      t.amount = 799;
    },
    (t: ReturnType<typeof setup>['transfer']) => {
      t.metadata.roveDriverId = uuid(8);
    },
    (t: ReturnType<typeof setup>['transfer']) => {
      t.metadata.roveTransferOperationId = uuid(8);
    },
    (t: ReturnType<typeof setup>['transfer']) => {
      t.source_transaction = 'ch_other';
    },
    (t: ReturnType<typeof setup>['transfer']) => {
      t.transfer_group = 'unrelated';
    },
    (t: ReturnType<typeof setup>['transfer']) => {
      t.balance_transaction.amount = 800;
      t.balance_transaction.net = 800;
    },
    (t: ReturnType<typeof setup>['transfer']) => {
      t.balance_transaction.source = 'tr_other';
    },
    (t: ReturnType<typeof setup>['transfer']) => {
      t.balance_transaction.type = 'payout';
    },
    (t: ReturnType<typeof setup>['transfer']) => {
      t.balance_transaction.net = -799;
    },
    (t: ReturnType<typeof setup>['transfer']) => {
      t.amount_reversed = 801;
    },
    (t: ReturnType<typeof setup>['transfer']) => {
      t.reversed = true;
    },
  ]) {
    const s = setup();
    mutate(s.transfer);
    await expect(s.provider.retrieve(reference, 'tr_payment')).rejects.toMatchObject(unavailable);
  }
});
function reversal(n: number, amount: number) {
  return {
    id: `trr_${n}`,
    object: 'transfer_reversal',
    amount,
    currency: 'usd',
    transfer: 'tr_payment',
    balance_transaction: balance(`trr_${n}`, amount, 'transfer_refund'),
  };
}
test('reads all reversal pages and preserves signed fees and actual balance changes', async () => {
  const s = setup();
  s.transfer.amount_reversed = 300;
  const a = reversal(1, 100),
    b = reversal(2, 200);
  b.balance_transaction.fee = -5;
  b.balance_transaction.net = 205;
  s.reversals
    .mockResolvedValueOnce({ object: 'list', data: [a], has_more: true })
    .mockResolvedValueOnce({ object: 'list', data: [b], has_more: false });
  const result = await s.provider.retrieve(reference, 'tr_payment');
  expect(result.reversedCents).toBe(300);
  expect(result.movements[2]).toMatchObject({
    kind: 'transfer_refund',
    amountCents: 200,
    feeCents: -5,
    netCents: 205,
  });
  expect(s.reversals.mock.calls[1]).toEqual([
    'tr_payment',
    {
      limit: 100,
      starting_after: 'trr_1',
      expand: ['data.balance_transaction'],
    },
  ]);
});
test('rejects missing, duplicate, foreign and concurrently inconsistent reversal records', async () => {
  for (const mutate of [
    (s: ReturnType<typeof setup>, _v: ReturnType<typeof reversal>) => {
      s.transfer.amount_reversed = 200;
    },
    (s: ReturnType<typeof setup>, _v: ReturnType<typeof reversal>) => {
      s.transfer.amount_reversed = 0;
    },
    (s: ReturnType<typeof setup>, v: ReturnType<typeof reversal>) => {
      v.transfer = 'tr_other';
    },
    (s: ReturnType<typeof setup>, v: ReturnType<typeof reversal>) => {
      v.balance_transaction.source = 'trr_other';
    },
    (s: ReturnType<typeof setup>, v: ReturnType<typeof reversal>) => {
      v.balance_transaction.type = 'transfer';
    },
    (s: ReturnType<typeof setup>, v: ReturnType<typeof reversal>) => {
      v.balance_transaction.id = s.transfer.balance_transaction.id;
    },
  ]) {
    const s = setup(),
      v = reversal(1, 100);
    s.transfer.amount_reversed = 100;
    mutate(s, v);
    s.reversals.mockResolvedValue({ object: 'list', data: [v], has_more: false });
    await expect(s.provider.find(reference)).rejects.toMatchObject(unavailable);
  }
  const s = setup();
  s.transfer.amount_reversed = 200;
  s.reversals.mockResolvedValue({
    object: 'list',
    data: [reversal(1, 100), reversal(1, 100)],
    has_more: false,
  });
  await expect(s.provider.find(reference)).rejects.toMatchObject(unavailable);
  s.reversals.mockResolvedValue({ object: 'list', data: [], has_more: true });
  await expect(s.provider.find(reference)).rejects.toMatchObject(unavailable);
});
test('bounds reversal pagination and sanitizes provider errors', async () => {
  const s = setup();
  s.transfer.amount_reversed = 800;
  s.transfer.reversed = true;
  for (let i = 1; i <= 10; i++)
    s.reversals.mockResolvedValueOnce({ object: 'list', data: [reversal(i, 1)], has_more: true });
  await expect(s.provider.find(reference)).rejects.toMatchObject(unavailable);
  expect(s.reversals).toHaveBeenCalledTimes(10);
  s.list.mockRejectedValue(new Error('PRIVATE_PROVIDER_DETAIL'));
  await expect(s.provider.find(reference)).rejects.not.toThrow('PRIVATE_PROVIDER_DETAIL');
  s.account.mockResolvedValue({ id: 'acct_wrong', object: 'account' });
  await expect(s.provider.retrieve(reference, 'tr_payment')).rejects.toMatchObject(unavailable);
  expect(s.retrieve).not.toHaveBeenCalled();
});

test('expired or future first attempts cannot mutate, while read-only recovery remains available', async () => {
  for (const millis of [-1, 23 * 60 * 60 * 1000]) {
    const s = setup();
    s.now.mockReturnValue(new Date(Date.parse(reference.firstAttemptAt) + millis));
    await expect(s.provider.create(reference)).rejects.toMatchObject({ code: 'TRANSFER_REVIEW_REQUIRED' });
    expect(s.create).not.toHaveBeenCalled();
    expect(s.account).not.toHaveBeenCalled();
    if (millis > 0) expect((await s.provider.find(reference))?.id).toBe('tr_payment');
  }
  const s = setup();
  s.status.mockImplementation(async () => {
    s.now.mockReturnValue(new Date(Date.parse(reference.firstAttemptAt) + 23 * 60 * 60 * 1000));
    return 'ready';
  });
  await expect(s.provider.create(reference)).rejects.toMatchObject({ code: 'TRANSFER_REVIEW_REQUIRED' });
  expect(s.create).not.toHaveBeenCalled();
});
test('correlated records must also have a plausible creation time', async () => {
  for (const timestamp of [1789199900, 1789201000]) {
    const s = setup();
    s.transfer.created = timestamp;
    await expect(s.provider.find(reference)).rejects.toMatchObject(unavailable);
  }
});

test('rejects automatic destination/on-behalf-of charge models before a separate transfer', async () => {
  for (const override of [
    { transfer_data: { destination: 'acct_driver' } },
    { on_behalf_of: 'acct_driver' },
    { application_fee_amount: 100 },
  ]) {
    const s = setup();
    s.payment.mockResolvedValue({ ...s.intent, ...override });
    await expect(s.provider.create(reference)).rejects.toMatchObject(unavailable);
    expect(s.create).not.toHaveBeenCalled();
  }
});
