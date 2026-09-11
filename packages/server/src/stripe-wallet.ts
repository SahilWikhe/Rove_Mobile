import Stripe from 'stripe';
import { z } from 'zod';
import { DomainError } from './errors';
import type { WalletProvider } from './wallet-sessions';

const Customer = z.string().regex(/^cus_[a-zA-Z0-9]{1,96}$/);
const Session = z.object({
  object: z.literal('customer_session'),
  customer: Customer,
  livemode: z.boolean(),
  client_secret: z.string().min(1).max(1024),
  expires_at: z.number().int().positive(),
});
const Setup = z.object({
  object: z.literal('setup_intent'),
  id: z.string().regex(/^seti_[a-zA-Z0-9]+$/),
  customer: Customer,
  livemode: z.boolean(),
  usage: z.literal('on_session'),
  client_secret: z.string().min(1).max(1024),
  status: z.enum([
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
    'processing',
    'succeeded',
  ]),
});
type Client = Pick<Stripe, 'customerSessions' | 'setupIntents'>;
const mismatch = () =>
  new DomainError('PAYMENT_REFERENCE_MISMATCH', 'Payment settings could not be verified.', 503);

export class StripeWalletProvider implements WalletProvider {
  private client: Client;
  constructor(
    private config: { secretKey: string; live: boolean; paymentMethodConfiguration: string },
    client?: Client,
    private now: () => number = Date.now,
  ) {
    if (
      !new RegExp(`^(sk|rk)_${config.live ? 'live' : 'test'}_[a-zA-Z0-9]+$`).test(config.secretKey) ||
      !/^pmc_[a-zA-Z0-9]{1,96}$/.test(config.paymentMethodConfiguration)
    )
      throw new Error('Stripe wallet configuration does not match its environment.');
    this.client =
      client ??
      new Stripe(config.secretKey, { apiVersion: '2026-08-26.dahlia', timeout: 10000, maxNetworkRetries: 2 });
  }
  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch {
      throw new DomainError(
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'Payment settings are temporarily unavailable.',
        503,
      );
    }
  }
  private customer(value: string) {
    if (!Customer.safeParse(value).success)
      throw new DomainError('INVALID_PAYMENT_REQUEST', 'Payment settings could not be loaded.', 422);
  }
  async customerSession(customerId: string, purpose: 'settings' | 'payment' = 'settings') {
    this.customer(customerId);
    const raw = await this.call(() =>
      this.client.customerSessions.create({
        customer: customerId,
        components:
          purpose === 'payment'
            ? {
                mobile_payment_element: {
                  enabled: true,
                  features: {
                    payment_method_redisplay: 'enabled',
                    payment_method_save: 'disabled',
                    payment_method_remove: 'disabled',
                    payment_method_allow_redisplay_filters: ['always'],
                  },
                },
              }
            : {
                customer_sheet: {
                  enabled: true,
                  features: {
                    payment_method_remove: 'enabled',
                    payment_method_allow_redisplay_filters: ['always'],
                  },
                },
              },
      }),
    );
    const parsed = Session.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.customer !== customerId ||
      parsed.data.livemode !== this.config.live ||
      parsed.data.expires_at * 1000 <= this.now()
    )
      throw mismatch();
    return { customerId, clientSecret: parsed.data.client_secret };
  }
  async setupSession(customerId: string, idempotencyKey: string) {
    this.customer(customerId);
    if (!/^[a-zA-Z0-9:_/-]{8,255}$/.test(idempotencyKey))
      throw new DomainError('INVALID_PAYMENT_REQUEST', 'Payment settings could not be loaded.', 422);
    const raw = await this.call(() =>
      this.client.setupIntents.create(
        {
          customer: customerId,
          usage: 'on_session',
          payment_method_configuration: this.config.paymentMethodConfiguration,
          automatic_payment_methods: { enabled: true },
        },
        { idempotencyKey },
      ),
    );
    const parsed = Setup.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.customer !== customerId ||
      parsed.data.livemode !== this.config.live ||
      !parsed.data.client_secret.startsWith(parsed.data.id + '_secret_')
    )
      throw mismatch();
    return { clientSecret: parsed.data.client_secret };
  }
}
