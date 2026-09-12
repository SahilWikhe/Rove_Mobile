import { expect, test, vi } from 'vitest';
import Stripe from 'stripe';
import { StripePaymentProvider } from './stripe-payments';
const config = {
  secretKey: 'sk_test_fixture',
  webhookSecret: 'whsec_fixture',
  live: false,
  paymentMethodConfiguration: 'pmc_fixture',
};
const reference = {
  intentId: 'pi_fixture',
  rideId: '00000000-0000-4000-8000-000000000001',
  attemptId: '00000000-0000-4000-8000-000000000002',
  customerId: 'cus_fixture',
  amountCents: 1050,
};
const requestKey = 'rove:fixture:authorize';
function intent(extra: Record<string, unknown> = {}) {
  return {
    id: reference.intentId,
    object: 'payment_intent',
    livemode: false,
    amount: 1050,
    currency: 'usd',
    capture_method: 'manual',
    customer: reference.customerId,
    metadata: { roveRideId: reference.rideId, roveAttemptId: reference.attemptId },
    status: 'requires_capture',
    amount_capturable: 1050,
    amount_received: 0,
    client_secret: 'pi_fixture_secret_private',
    ...extra,
  };
}
function fixture() {
  const paymentIntents = {
    create: vi.fn().mockResolvedValue(intent({ status: 'requires_payment_method', amount_capturable: 0 })),
    retrieve: vi.fn().mockResolvedValue(intent()),
    capture: vi
      .fn()
      .mockResolvedValue(intent({ status: 'succeeded', amount_capturable: 0, amount_received: 1050 })),
    cancel: vi.fn().mockResolvedValue(intent({ status: 'canceled', amount_capturable: 0 })),
  };
  const refunds = {
    list: vi.fn().mockResolvedValue({ object: 'list', data: [], has_more: false }),
    create: vi.fn().mockResolvedValue({
      id: 're_fixture',
      payment_intent: 'pi_fixture',
      currency: 'usd',
      amount: 1,
      status: 'pending',
    }),
  };
  const sdk = new Stripe(config.secretKey);
  const customers = { create: vi.fn() };
  const disputes = { list: vi.fn().mockResolvedValue({ object: 'list', data: [], has_more: false }) };
  const client = { paymentIntents, refunds, customers, disputes, webhooks: sdk.webhooks } as unknown as Pick<
    Stripe,
    'paymentIntents' | 'refunds' | 'webhooks' | 'customers' | 'disputes'
  >;
  return {
    paymentIntents,
    refunds,
    customers,
    disputes,
    sdk,
    provider: new StripePaymentProvider(config, client),
  };
}
test('creates a configured manual-capture intent using server references and stable idempotency', async () => {
  const { provider, paymentIntents } = fixture();
  const { intentId: _id, ...input } = reference;
  const result = await provider.create(input, requestKey);
  expect(paymentIntents.create).toHaveBeenCalledWith(
    {
      amount: 1050,
      currency: 'usd',
      customer: 'cus_fixture',
      capture_method: 'manual',
      payment_method_configuration: 'pmc_fixture',
      metadata: { roveRideId: reference.rideId, roveAttemptId: reference.attemptId },
    },
    { idempotencyKey: requestKey },
  );
  expect(result.payment.status).toBe('requires_payment_method');
  expect(JSON.stringify(result.payment)).not.toContain('secret');
  expect(result.clientSecret).toBe('pi_fixture_secret_private');
});
test('rejects wrong environment credentials and malformed or fractional amounts before sending', async () => {
  expect(() => new StripePaymentProvider({ ...config, live: true })).toThrow();
  expect(() => new StripePaymentProvider({ ...config, paymentMethodConfiguration: '' })).toThrow();
  const { provider, paymentIntents } = fixture();
  const { intentId: _id, ...input } = reference;
  await expect(provider.create({ ...input, amountCents: 1.5 }, requestKey)).rejects.toMatchObject({
    status: 422,
  });
  expect(paymentIntents.create).not.toHaveBeenCalled();
});
test('mismatched provider references prevent capture before any financial mutation', async () => {
  for (const change of [
    { customer: 'cus_other' },
    { amount: 1049 },
    { currency: 'eur' },
    { livemode: true },
    { capture_method: 'automatic' },
    { id: 'pi_other' },
    { metadata: { roveRideId: reference.attemptId, roveAttemptId: reference.attemptId } },
  ]) {
    const { provider, paymentIntents } = fixture();
    paymentIntents.retrieve.mockResolvedValue(intent(change));
    await expect(provider.capture(reference, 1050, 'rove:fixture:capture')).rejects.toMatchObject({
      code: 'PAYMENT_REFERENCE_MISMATCH',
    });
    expect(paymentIntents.capture).not.toHaveBeenCalled();
  }
});
test('single capture omits multicapture options and recognizes an already captured retry', async () => {
  const { provider, paymentIntents } = fixture();
  expect((await provider.capture(reference, 1050, 'rove:fixture:capture')).status).toBe('succeeded');
  expect(paymentIntents.capture).toHaveBeenCalledWith(
    'pi_fixture',
    { amount_to_capture: 1050 },
    { idempotencyKey: 'rove:fixture:capture' },
  );
  paymentIntents.retrieve.mockResolvedValue(
    intent({ status: 'succeeded', amount_capturable: 0, amount_received: 1050 }),
  );
  await provider.capture(reference, 1050, 'rove:fixture:capture');
  expect(paymentIntents.capture).toHaveBeenCalledTimes(1);
});
test('action-required or underfunded intents cannot be captured', async () => {
  for (const change of [{ status: 'requires_action', amount_capturable: 0 }, { amount_capturable: 500 }]) {
    const { provider, paymentIntents } = fixture();
    paymentIntents.retrieve.mockResolvedValue(intent(change));
    await expect(provider.capture(reference, 1050, 'rove:fixture:capture')).rejects.toMatchObject({
      code: 'PAYMENT_NOT_CAPTURABLE',
    });
    expect(paymentIntents.capture).not.toHaveBeenCalled();
  }
});
test('release is idempotent and never converts a captured payment into an implicit refund', async () => {
  const { provider, paymentIntents, refunds } = fixture();
  expect((await provider.cancel(reference, 'rove:fixture:release')).status).toBe('canceled');
  paymentIntents.retrieve.mockResolvedValue(intent({ status: 'canceled', amount_capturable: 0 }));
  await provider.cancel(reference, 'rove:fixture:release');
  expect(paymentIntents.cancel).toHaveBeenCalledTimes(1);
  paymentIntents.retrieve.mockResolvedValue(
    intent({ status: 'succeeded', amount_received: 1050, amount_capturable: 0 }),
  );
  await expect(provider.cancel(reference, 'rove:fixture:release')).rejects.toMatchObject({
    code: 'PAYMENT_ALREADY_CAPTURED',
  });
  expect(refunds.create).not.toHaveBeenCalled();
});
test('partial refunds can be one cent and pending refunds are not treated as settled', async () => {
  const { provider, paymentIntents, refunds } = fixture();
  paymentIntents.retrieve.mockResolvedValue(
    intent({ status: 'succeeded', amount_received: 500, amount_capturable: 0 }),
  );
  expect(await provider.refund(reference, 1, 'rove:fixture:refund')).toEqual({
    id: 're_fixture',
    status: 'pending',
    amountCents: 1,
  });
  await expect(provider.refund(reference, 501, 'rove:fixture:refund2')).rejects.toMatchObject({
    code: 'PAYMENT_NOT_REFUNDABLE',
  });
  expect(refunds.create).toHaveBeenCalledTimes(1);
});
test('provider failures never expose keys, client secrets or card details', async () => {
  const { provider, paymentIntents } = fixture();
  paymentIntents.retrieve.mockRejectedValue(new Error('sk_test_private pi_secret_private card-data'));
  await expect(provider.retrieve(reference)).rejects.toMatchObject({
    code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    status: 503,
  });
  await expect(provider.retrieve(reference)).rejects.not.toThrow('private');
});
test('webhooks require the raw signed body, correct mode and a fresh timestamp', () => {
  const { provider, sdk } = fixture();
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    id: 'evt_fixture',
    object: 'event',
    type: 'payment_intent.amount_capturable_updated',
    created: timestamp,
    livemode: false,
    data: { object: intent() },
  });
  const sign = (payload: string, time = timestamp) =>
    sdk.webhooks.generateTestHeaderString({ payload, secret: config.webhookSecret, timestamp: time });
  expect(provider.verifyWebhook(body, sign(body))).toEqual({
    id: 'evt_fixture',
    type: 'payment_intent.amount_capturable_updated',
    created: timestamp,
    resourceId: 'pi_fixture',
  });
  expect(() => provider.verifyWebhook(body + ' ', sign(body))).toThrow();
  expect(() => provider.verifyWebhook(body, sign(body, timestamp - 601))).toThrow();
  expect(() => provider.verifyWebhook(body, sign(body, timestamp + 601))).toThrow();
  const live = body.replace('"livemode":false', '"livemode":true');
  expect(() => provider.verifyWebhook(live, sign(live))).toThrow();
  expect(JSON.stringify(provider.verifyWebhook(body, sign(body)))).not.toContain('secret');
});

test('mapped sessions retrieve the existing intent and validate ownership before exposing its secret', async () => {
  const { provider, paymentIntents } = fixture();
  expect((await provider.session(reference)).clientSecret).toBe('pi_fixture_secret_private');
  expect(paymentIntents.create).not.toHaveBeenCalled();
  paymentIntents.retrieve.mockResolvedValue(intent({ customer: 'cus_other' }));
  await expect(provider.session(reference)).rejects.toMatchObject({ code: 'PAYMENT_REFERENCE_MISMATCH' });
});

test('customer provisioning sends reference metadata only and verifies provider mode and ownership', async () => {
  const { provider, customers } = fixture();
  const reference = {
    riderId: '00000000-0000-4000-8000-000000000001',
    bindingId: '00000000-0000-4000-8000-000000000002',
  };
  const customer = {
    id: 'cus_fixture',
    object: 'customer',
    livemode: false,
    metadata: { roveRiderId: reference.riderId, roveBindingId: reference.bindingId },
  };
  customers.create.mockResolvedValue(customer);
  expect(await provider.createCustomer(reference, 'rove:fixture:customer')).toBe('cus_fixture');
  expect(customers.create).toHaveBeenCalledWith(
    { metadata: customer.metadata },
    { idempotencyKey: 'rove:fixture:customer' },
  );
  for (const change of [
    { livemode: true },
    { metadata: { ...customer.metadata, roveRiderId: reference.bindingId } },
    { id: 'wrong' },
  ]) {
    customers.create.mockResolvedValue({ ...customer, ...change });
    await expect(provider.createCustomer(reference, 'rove:fixture:customer')).rejects.toMatchObject({
      code: 'PAYMENT_REFERENCE_MISMATCH',
    });
  }
});

function refunded(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    object: 'refund',
    payment_intent: reference.intentId,
    amount: 100,
    currency: 'usd',
    status: 'succeeded',
    created: 1700000000,
    ...extra,
  };
}
function refundFixture() {
  const f = fixture();
  f.paymentIntents.retrieve.mockResolvedValue(
    intent({ status: 'succeeded', amount_capturable: 0, amount_received: 1050 }),
  );
  return f;
}
test('refund history verifies the persisted payment before listing and follows every cursor', async () => {
  const f = refundFixture();
  f.refunds.list
    .mockResolvedValueOnce({
      object: 'list',
      data: [refunded('re_first', { status: 'pending' })],
      has_more: true,
    })
    .mockResolvedValueOnce({
      object: 'list',
      data: [
        refunded('re_second', { payment_intent: { id: reference.intentId }, status: 'requires_action' }),
        refunded('re_third', { status: 'failed' }),
        refunded('re_fourth', { status: 'canceled' }),
        refunded('re_fifth'),
      ],
      has_more: false,
    });
  const result = await f.provider.refunds(reference);
  expect(result.refunds.map((item) => item.status)).toEqual([
    'pending',
    'requires_action',
    'failed',
    'canceled',
    'succeeded',
  ]);
  expect(result.refunds[0]).toEqual({
    id: 're_first',
    balanceTransactions: [],
    intentId: reference.intentId,
    amountCents: 100,
    status: 'pending',
    created: 1700000000,
  });
  expect(f.refunds.list.mock.calls).toEqual([
    [
      {
        payment_intent: reference.intentId,
        limit: 100,
        expand: ['data.balance_transaction', 'data.failure_balance_transaction'],
      },
    ],
    [
      {
        payment_intent: reference.intentId,
        limit: 100,
        starting_after: 're_first',
        expand: ['data.balance_transaction', 'data.failure_balance_transaction'],
      },
    ],
  ]);
  expect(f.refunds.create).not.toHaveBeenCalled();
  f.paymentIntents.retrieve.mockResolvedValueOnce(intent({ customer: 'cus_other' }));
  f.refunds.list.mockClear();
  await expect(f.provider.refunds(reference)).rejects.toMatchObject({ code: 'PAYMENT_REFERENCE_MISMATCH' });
  expect(f.refunds.list).not.toHaveBeenCalled();
});
test('refund history rejects wrong intent, currency, amount, unknown status and malformed pagination', async () => {
  const f = refundFixture();
  for (const bad of [
    { payment_intent: 'pi_other' },
    { currency: 'eur' },
    { amount: 1051 },
    { amount: 1.5 },
    { status: null },
    { status: 'unknown' },
    { created: -1 },
  ]) {
    f.refunds.list.mockResolvedValueOnce({
      object: 'list',
      data: [refunded('re_bad', bad)],
      has_more: false,
    });
    await expect(f.provider.refunds(reference)).rejects.toMatchObject({ code: 'PAYMENT_REFERENCE_MISMATCH' });
  }
  f.refunds.list.mockResolvedValueOnce({ object: 'list', data: [], has_more: true });
  await expect(f.provider.refunds(reference)).rejects.toMatchObject({ code: 'PAYMENT_REFERENCE_MISMATCH' });
  f.refunds.list.mockResolvedValueOnce({ object: 'list', data: [], has_more: 'false' });
  await expect(f.provider.refunds(reference)).rejects.toMatchObject({ code: 'PAYMENT_REFERENCE_MISMATCH' });
});
test('refund history rejects duplicate pages and overcommitted totals without treating failed refunds as paid', async () => {
  const f = refundFixture();
  f.refunds.list
    .mockResolvedValueOnce({ object: 'list', data: [refunded('re_same')], has_more: true })
    .mockResolvedValueOnce({ object: 'list', data: [refunded('re_same')], has_more: false });
  await expect(f.provider.refunds(reference)).rejects.toMatchObject({ code: 'PAYMENT_REFERENCE_MISMATCH' });
  f.refunds.list.mockResolvedValueOnce({
    object: 'list',
    data: [refunded('re_a', { amount: 600, status: 'pending' }), refunded('re_b', { amount: 600 })],
    has_more: false,
  });
  await expect(f.provider.refunds(reference)).rejects.toMatchObject({ code: 'PAYMENT_REFERENCE_MISMATCH' });
  f.refunds.list.mockResolvedValueOnce({
    object: 'list',
    data: [refunded('re_a', { amount: 1000, status: 'failed' }), refunded('re_b', { amount: 1000 })],
    has_more: false,
  });
  expect((await f.provider.refunds(reference)).refunds).toHaveLength(2);
});
test('refund history bounds pagination and sanitizes provider errors after a partial read', async () => {
  const f = refundFixture();
  for (let i = 0; i < 10; i++)
    f.refunds.list.mockResolvedValueOnce({
      object: 'list',
      data: [refunded(`re_page${i}`, { amount: 1 })],
      has_more: true,
    });
  await expect(f.provider.refunds(reference)).rejects.toMatchObject({
    code: 'PAYMENT_REFUND_REVIEW_REQUIRED',
  });
  expect(f.refunds.list).toHaveBeenCalledTimes(10);
  f.refunds.list
    .mockResolvedValueOnce({ object: 'list', data: [refunded('re_partial')], has_more: true })
    .mockRejectedValueOnce(new Error('private provider details'));
  await expect(f.provider.refunds(reference)).rejects.toMatchObject({
    code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    message: 'Payment could not be confirmed. Please try again shortly.',
  });
});

test('refund mutation tags its durable operation and history returns only the validated correlation', async () => {
  const f = refundFixture();
  const operationId = '00000000-0000-4000-8000-000000000099';
  await f.provider.refund(reference, 1, `rove-refund:${operationId}`);
  expect(f.refunds.create.mock.calls[0]![0].metadata).toMatchObject({ roveRefundOperationId: operationId });
  f.refunds.list.mockResolvedValue({
    object: 'list',
    has_more: false,
    data: [
      refunded('re_tagged', {
        metadata: { roveRefundOperationId: operationId, privateNote: 'do not expose' },
      }),
    ],
  });
  const result = await f.provider.refunds(reference);
  expect(result.refunds[0]?.operationId).toBe(operationId);
  expect(JSON.stringify(result)).not.toContain('privateNote');
  f.refunds.list.mockResolvedValue({
    object: 'list',
    has_more: false,
    data: [refunded('re_tagged', { metadata: { roveRefundOperationId: 'invalid' } })],
  });
  await expect(f.provider.refunds(reference)).rejects.toThrow();
});
test('refund balance records validate linkage, currency, direction and net arithmetic', async () => {
  const f = refundFixture();
  const balance = {
    id: 'txn_refund',
    object: 'balance_transaction',
    source: 're_balance',
    currency: 'usd',
    type: 'refund',
    amount: -100,
    fee: 5,
    net: -105,
  };
  const list = (extra: Record<string, unknown> = {}) =>
    f.refunds.list.mockResolvedValue({
      object: 'list',
      has_more: false,
      data: [refunded('re_balance', { metadata: null, balance_transaction: { ...balance, ...extra } })],
    });
  list();
  expect((await f.provider.refunds(reference)).refunds[0]?.balanceTransactions).toEqual([
    {
      id: 'txn_refund',
      refundId: 're_balance',
      kind: 'refund',
      amountCents: -100,
      feeCents: 5,
      netCents: -105,
    },
  ]);
  for (const invalid of [
    { source: 're_other' },
    { currency: 'eur' },
    { amount: 100 },
    { net: -100 },
    { type: 'charge' },
  ]) {
    list(invalid);
    await expect(f.provider.refunds(reference)).rejects.toThrow();
  }
  f.refunds.list.mockResolvedValue({
    object: 'list',
    has_more: false,
    data: [refunded('re_balance', { balance_transaction: 'txn_unexpanded' })],
  });
  await expect(f.provider.refunds(reference)).rejects.toThrow();
  f.refunds.list.mockResolvedValue({
    object: 'list',
    has_more: false,
    data: [
      refunded('re_balance', {
        status: 'failed',
        balance_transaction: balance,
        failure_balance_transaction: {
          ...balance,
          id: 'txn_failure',
          type: 'refund_failure',
          amount: 100,
          fee: 0,
          net: 100,
        },
      }),
    ],
  });
  expect((await f.provider.refunds(reference)).refunds[0]?.balanceTransactions).toHaveLength(2);
});

function disputed(extra: Record<string, unknown> = {}) {
  return {
    id: 'du_fixture',
    object: 'dispute',
    livemode: false,
    payment_intent: reference.intentId,
    currency: 'usd',
    amount: 1050,
    status: 'needs_response',
    reason: 'general',
    created: 1700000000,
    evidence_details: { due_by: 1790000000 },
    balance_transactions: [],
    evidence: { customer_email_address: 'private@example.invalid' },
    ...extra,
  };
}
test('dispute reader verifies payment references, follows cursors, and strips private evidence', async () => {
  const f = refundFixture();
  f.disputes.list
    .mockResolvedValueOnce({ object: 'list', has_more: true, data: [disputed()] })
    .mockResolvedValueOnce({
      object: 'list',
      has_more: false,
      data: [disputed({ id: 'dp_legacy', payment_intent: { id: reference.intentId }, status: 'won' })],
    });
  const result = await f.provider.disputes(reference);
  expect(result.disputes).toHaveLength(2);
  expect(result.disputes[0]?.dueBy).toBe(1790000000);
  expect(JSON.stringify(result)).not.toContain('private@example.invalid');
  expect(f.disputes.list.mock.calls[1]![0]).toMatchObject({
    payment_intent: reference.intentId,
    starting_after: 'du_fixture',
    limit: 100,
  });
  f.paymentIntents.retrieve.mockResolvedValue(intent({ customer: 'cus_other' }));
  f.disputes.list.mockClear();
  await expect(f.provider.disputes(reference)).rejects.toThrow();
  expect(f.disputes.list).not.toHaveBeenCalled();
});
test('dispute reader rejects partial/mismatched history and invalid balance arithmetic', async () => {
  const f = refundFixture();
  for (const extra of [
    { livemode: true },
    { payment_intent: 'pi_other' },
    { currency: 'eur' },
    { status: 'invented' },
    {
      balance_transactions: [
        {
          id: 'txn_dispute',
          source: 'du_other',
          currency: 'usd',
          type: 'adjustment',
          amount: -1050,
          fee: 1500,
          net: -2550,
        },
      ],
    },
  ]) {
    f.disputes.list.mockResolvedValueOnce({ object: 'list', has_more: false, data: [disputed(extra)] });
    await expect(f.provider.disputes(reference)).rejects.toThrow();
  }
  f.disputes.list.mockResolvedValue({ object: 'list', has_more: true, data: [disputed()] });
  await expect(f.provider.disputes(reference)).rejects.toThrow();
  f.disputes.list.mockResolvedValue({
    object: 'list',
    has_more: false,
    data: [
      disputed({
        balance_transactions: [
          {
            id: 'txn_dispute',
            source: 'du_fixture',
            currency: 'usd',
            type: 'adjustment',
            amount: -1050,
            fee: 1500,
            net: -2550,
          },
        ],
      }),
    ],
  });
  expect((await f.provider.disputes(reference)).disputes[0]?.balanceTransactions[0]?.netCents).toBe(-2550);
});
