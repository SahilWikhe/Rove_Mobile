import Stripe from 'stripe';
import { z } from 'zod';
import { BankPayout, BankPayoutCursor } from '@rove/contracts';
import type { BankPayoutProvider } from './bank-payouts';
import type { DriverPayoutProvider, DriverPayoutReference } from './driver-payout-provider';
import { DomainError } from './errors';
export type BankPayoutClient = Pick<Stripe, 'accounts' | 'payouts'>;
const AccountId = z.string().regex(/^acct_[a-zA-Z0-9]{1,96}$/);
const Reference = z.object({ driverId: z.uuid(), bindingId: z.uuid(), accountId: AccountId });
const Time = z.number().int().min(0).max(4_102_444_800);
const Payout = z.object({
  id: BankPayoutCursor,
  object: z.literal('payout'),
  livemode: z.boolean(),
  amount: z.number().int().min(1).max(99_999_999),
  currency: z.literal('usd'),
  status: z.enum(['pending', 'in_transit', 'paid', 'failed', 'canceled']),
  created: Time,
  arrival_date: Time,
  type: z.enum(['bank_account', 'card']),
});
const Page = z.object({
  object: z.literal('list'),
  url: z.literal('/v1/payouts'),
  has_more: z.boolean(),
  data: z.array(Payout).max(20),
});
const unavailable = () =>
  new DomainError(
    'BANK_PAYOUT_PROVIDER_UNAVAILABLE',
    'Bank payout history could not be verified. Try again.',
    503,
  );
/** Read-only account-level status. A payout can contain multiple transfers; never infer a ride-to-bank match. */
export class StripeBankPayouts implements BankPayoutProvider {
  private client: BankPayoutClient;
  constructor(
    private config: { secretKey: string; live: boolean; platformAccountId: string },
    private recipient: Pick<DriverPayoutProvider, 'status'>,
    client?: BankPayoutClient,
    private now: () => Date = () => new Date(),
  ) {
    if (
      !new RegExp(`^(sk|rk)_${config.live ? 'live' : 'test'}_[a-zA-Z0-9]+$`).test(config.secretKey) ||
      !AccountId.safeParse(config.platformAccountId).success
    )
      throw new Error('Invalid bank payout configuration.');
    this.client =
      client ??
      new Stripe(config.secretKey, { apiVersion: '2026-08-26.dahlia', timeout: 10000, maxNetworkRetries: 2 });
  }
  async list(raw: DriverPayoutReference & { accountId: string }, after?: string) {
    try {
      const r = Reference.parse(raw);
      if (r.accountId === this.config.platformAccountId) throw unavailable();
      if (after !== undefined) BankPayoutCursor.parse(after);
      const platform = z
        .object({ id: AccountId, object: z.literal('account') })
        .parse(await this.client.accounts.retrieve(null));
      if (platform.id !== this.config.platformAccountId) throw unavailable();
      // Verifies v2 account mode and driver/binding metadata, even when capabilities need remediation.
      await this.recipient.status(r);
      const page = Page.parse(
        await this.client.payouts.list(
          { limit: 20, ...(after ? { starting_after: after } : {}) },
          { stripeAccount: r.accountId },
        ),
      );
      const seen = new Set<string>();
      let previous = Infinity;
      for (const p of page.data) {
        if (
          p.livemode !== this.config.live ||
          seen.has(p.id) ||
          p.id === after ||
          p.created > previous ||
          p.created * 1000 > this.now().getTime() + 10000
        )
          throw unavailable();
        seen.add(p.id);
        previous = p.created;
      }
      if (page.has_more && page.data.length === 0) throw unavailable();
      return {
        items: page.data.map((p) =>
          BankPayout.parse({
            id: p.id,
            amountCents: p.amount,
            currency: p.currency,
            status: p.status,
            createdAt: new Date(p.created * 1000).toISOString(),
            expectedArrivalAt: new Date(p.arrival_date * 1000).toISOString(),
            destinationType: p.type,
          }),
        ),
        nextCursor: page.has_more ? page.data.at(-1)!.id : null,
      };
    } catch {
      throw unavailable();
    }
  }
}
