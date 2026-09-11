import Stripe from 'stripe';
import { expect, test, vi } from 'vitest';
import { StripeWalletProvider } from './stripe-wallet';
function fixture() {
  const session = {
    object: 'customer_session',
    customer: 'cus_fixture',
    livemode: false,
    client_secret: 'synthetic-secret',
    expires_at: 2000,
  };
  const setup = {
    object: 'setup_intent',
    id: 'seti_fixture',
    customer: 'cus_fixture',
    livemode: false,
    usage: 'on_session',
    client_secret: 'seti_fixture_secret_synthetic',
    status: 'requires_payment_method',
  };
  const customerCreate = vi.fn().mockResolvedValue(session);
  const setupCreate = vi.fn().mockResolvedValue(setup);
  const client = {
    customerSessions: { create: customerCreate },
    setupIntents: { create: setupCreate },
  } as unknown as Pick<Stripe, 'customerSessions' | 'setupIntents'>;
  const provider = new StripeWalletProvider(
    { secretKey: 'rk_test_fixture', live: false, paymentMethodConfiguration: 'pmc_fixture' },
    client,
    () => 1000000,
  );
  return { provider, customerCreate, setupCreate, session, setup };
}
test('settings session grants only the customer sheet with consented redisplay', async () => {
  const { provider, customerCreate } = fixture();
  await expect(provider.customerSession('cus_fixture')).resolves.toMatchObject({ customerId: 'cus_fixture' });
  expect(customerCreate).toHaveBeenCalledWith({
    customer: 'cus_fixture',
    components: {
      customer_sheet: {
        enabled: true,
        features: { payment_method_remove: 'enabled', payment_method_allow_redisplay_filters: ['always'] },
      },
    },
  });
});
test.each([{ customer: 'cus_other' }, { livemode: true }, { expires_at: 999 }, { client_secret: '' }])(
  'rejects untrusted settings response %j',
  async (change) => {
    const { provider, customerCreate, session } = fixture();
    customerCreate.mockResolvedValue({ ...session, ...change });
    await expect(provider.customerSession('cus_fixture')).rejects.toMatchObject({
      code: 'PAYMENT_REFERENCE_MISMATCH',
    });
  },
);
test('setup uses on-session consent, configured methods and the retry key without charging', async () => {
  const { provider, setupCreate } = fixture();
  await provider.setupSession('cus_fixture', 'rove:binding:wallet:request');
  expect(setupCreate).toHaveBeenCalledWith(
    {
      customer: 'cus_fixture',
      usage: 'on_session',
      payment_method_configuration: 'pmc_fixture',
      automatic_payment_methods: { enabled: true },
    },
    { idempotencyKey: 'rove:binding:wallet:request' },
  );
});
test.each([
  { customer: 'cus_other' },
  { livemode: true },
  { usage: 'off_session' },
  { client_secret: 'seti_other_secret_synthetic' },
  { status: 'canceled' },
])('rejects untrusted setup response %j', async (change) => {
  const { provider, setupCreate, setup } = fixture();
  setupCreate.mockResolvedValue({ ...setup, ...change });
  await expect(provider.setupSession('cus_fixture', 'rove:binding:wallet:request')).rejects.toMatchObject({
    code: 'PAYMENT_REFERENCE_MISMATCH',
  });
});
test('provider diagnostics never escape in customer-facing errors', async () => {
  const { provider, customerCreate } = fixture();
  customerCreate.mockRejectedValue(new Error('private card details and secret'));
  await expect(provider.customerSession('cus_fixture')).rejects.toMatchObject({
    message: 'Payment settings are temporarily unavailable.',
  });
});

test('checkout redisplays saved methods without granting settings mutations', async () => {
  const { provider, customerCreate } = fixture();
  await provider.customerSession('cus_fixture', 'payment');
  expect(customerCreate).toHaveBeenCalledWith({
    customer: 'cus_fixture',
    components: {
      mobile_payment_element: {
        enabled: true,
        features: {
          payment_method_redisplay: 'enabled',
          payment_method_save: 'disabled',
          payment_method_remove: 'disabled',
          payment_method_allow_redisplay_filters: ['always'],
        },
      },
    },
  });
});
