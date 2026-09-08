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
  const client = { paymentIntents, refunds, customers, webhooks: sdk.webhooks } as unknown as Pick<
    Stripe,
    'paymentIntents' | 'refunds' | 'webhooks' | 'customers'
  >;
  return { paymentIntents, refunds, customers, sdk, provider: new StripePaymentProvider(config, client) };
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
test('capture uses the persisted amount/key and recognizes an already captured retry', async () => {
  const { provider, paymentIntents } = fixture();
  expect((await provider.capture(reference, 1050, 'rove:fixture:capture')).status).toBe('succeeded');
  expect(paymentIntents.capture).toHaveBeenCalledWith(
    'pi_fixture',
    { amount_to_capture: 1050, final_capture: true },
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
