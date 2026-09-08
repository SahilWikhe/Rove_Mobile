import Stripe from 'stripe';
import { z } from 'zod';
import { DriverPayoutLink } from '@rove/contracts';
import { DomainError } from './errors';
import type { DriverPayoutProvider, DriverPayoutReference } from './driver-payout-provider';
const Reference = z.object({ driverId: z.uuid(), bindingId: z.uuid() });
const AccountId = z.string().regex(/^acct_[a-zA-Z0-9]{1,96}$/);
const Account = z.object({
  id: AccountId,
  object: z.literal('v2.core.account'),
  livemode: z.boolean(),
  metadata: z.object({ roveDriverId: z.uuid(), roveBindingId: z.uuid() }),
  configuration: z.object({
    recipient: z.object({
      capabilities: z.object({
        stripe_balance: z.object({
          stripe_transfers: z.object({ status: z.string() }),
          payouts: z.object({ status: z.string() }).optional(),
        }),
      }),
    }),
  }),
});
export type ConnectClient = Pick<Stripe['v2']['core'], 'accounts' | 'accountLinks'>;
const failure = () =>
  new DomainError(
    'PAYOUT_PROVIDER_UNAVAILABLE',
    'Payout setup could not be verified. Please try again.',
    503,
  );
/** Recipient onboarding only. This adapter does not transfer funds or approve drivers. */
export class StripeDriverPayouts implements DriverPayoutProvider {
  private client: ConnectClient;
  constructor(
    private config: { secretKey: string; live: boolean; origin: string },
    client?: ConnectClient,
  ) {
    const origin = new URL(config.origin);
    if (
      origin.origin !== config.origin ||
      origin.protocol !== 'https:' ||
      !new RegExp(`^(sk|rk)_${config.live ? 'live' : 'test'}_[a-zA-Z0-9]+$`).test(config.secretKey)
    )
      throw new Error('Invalid payout configuration.');
    this.client =
      client ??
      new Stripe(config.secretKey, { apiVersion: '2026-08-26.dahlia', timeout: 10000, maxNetworkRetries: 2 })
        .v2.core;
  }
  private async call<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch {
      throw failure();
    }
  }
  private inspect(raw: unknown, reference: DriverPayoutReference & { accountId?: string }) {
    const result = Account.safeParse(raw);
    if (
      !result.success ||
      result.data.livemode !== this.config.live ||
      result.data.metadata.roveDriverId !== reference.driverId ||
      result.data.metadata.roveBindingId !== reference.bindingId ||
      (reference.accountId && result.data.id !== reference.accountId)
    )
      throw failure();
    return result.data;
  }
  async createAccount(reference: DriverPayoutReference, key: string) {
    Reference.parse(reference);
    if (!/^[a-zA-Z0-9:-]{8,255}$/.test(key)) throw failure();
    const result = await this.call(() =>
      this.client.accounts.create(
        {
          identity: { country: 'us' },
          dashboard: 'express',
          defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
          configuration: {
            recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
          },
          metadata: { roveDriverId: reference.driverId, roveBindingId: reference.bindingId },
          include: ['configuration.recipient'],
        },
        { idempotencyKey: key },
      ),
    );
    return this.inspect(result, reference).id;
  }
  async status(reference: DriverPayoutReference & { accountId: string }) {
    Reference.parse(reference);
    AccountId.parse(reference.accountId);
    const result = await this.call(() =>
      this.client.accounts.retrieve(reference.accountId, { include: ['configuration.recipient'] }),
    );
    const balance = this.inspect(result, reference).configuration.recipient.capabilities.stripe_balance;
    if (balance.stripe_transfers.status === 'active' && balance.payouts?.status === 'active') return 'ready';
    if (balance.stripe_transfers.status === 'pending' || balance.payouts?.status === 'pending')
      return 'pending';
    return 'needs_information';
  }
  async onboardingLink(accountId: string) {
    AccountId.parse(accountId);
    const result = await this.call(() =>
      this.client.accountLinks.create({
        account: accountId,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            configurations: ['recipient'],
            refresh_url: this.config.origin + '/connect/refresh',
            return_url: this.config.origin + '/connect/return',
          },
        },
      }),
    );
    if (result.account !== accountId || result.livemode !== this.config.live) throw failure();
    const link = DriverPayoutLink.safeParse({ url: result.url, expiresAt: result.expires_at });
    if (!link.success) throw failure();
    return link.data;
  }
}
