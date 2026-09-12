import Stripe from 'stripe';
import { z } from 'zod';
import { DomainError } from './errors';
import type { PaymentReference } from './payment-provider';
import type { CaptureBalanceProvider } from './capture-balance-provider';

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-zA-Z0-9]{1,96}$`));
const NonnegativeAmount = z.number().int().min(0).max(99_999_999);
const Amount = NonnegativeAmount.min(1);
const Signed = z.number().int().min(-99_999_999).max(99_999_999);
const Payment = z.object({
  intentId: id('pi'),
  rideId: z.uuid(),
  attemptId: z.uuid(),
  customerId: id('cus'),
  amountCents: Amount,
});
const Balance = z
  .object({
    id: id('txn'),
    object: z.literal('balance_transaction'),
    source: z.string(),
    currency: z.literal('usd'),
    amount: Signed,
    fee: Signed,
    net: Signed,
    type: z.string(),
    status: z.enum(['pending', 'available']),
  })
  .refine((b) => b.net === b.amount - b.fee);
const Charge = z.object({
  id: id('ch'),
  object: z.literal('charge'),
  livemode: z.boolean(),
  payment_intent: id('pi'),
  paid: z.literal(true),
  captured: z.literal(true),
  status: z.literal('succeeded'),
  currency: z.literal('usd'),
  amount: Amount,
  amount_captured: Amount,
  amount_refunded: NonnegativeAmount,
  disputed: z.boolean(),
  balance_transaction: Balance,
});
const Intent = z.object({
  id: id('pi'),
  object: z.literal('payment_intent'),
  livemode: z.boolean(),
  amount: Amount,
  amount_received: Amount,
  amount_capturable: z.literal(0),
  capture_method: z.literal('manual'),
  transfer_data: z.null(),
  on_behalf_of: z.null(),
  application_fee_amount: z.null(),
  status: z.literal('succeeded'),
  currency: z.literal('usd'),
  customer: id('cus'),
  metadata: z.object({ roveRideId: z.uuid(), roveAttemptId: z.uuid() }),
  latest_charge: Charge,
});
export type CaptureBalanceClient = Pick<Stripe, 'accounts' | 'paymentIntents'>;
const failure = () =>
  new DomainError('CAPTURE_BALANCE_UNAVAILABLE', 'Captured payment balance could not be verified.', 503);
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw failure();
  return result.data;
}

/** Reads the original capture's gross amount, actual fee and net platform balance.
 * Refunds and disputes are separate movements; they do not rewrite this capture.
 * Pending balances are observations, not permission to book a settled fee.
 */
export class StripeCaptureBalances implements CaptureBalanceProvider {
  private client: CaptureBalanceClient;
  constructor(
    private config: { secretKey: string; live: boolean; platformAccountId: string },
    client?: CaptureBalanceClient,
  ) {
    if (
      !new RegExp(`^(sk|rk)_${config.live ? 'live' : 'test'}_[a-zA-Z0-9]+$`).test(config.secretKey) ||
      !id('acct').safeParse(config.platformAccountId).success
    )
      throw new Error('Invalid capture balance configuration.');
    this.client =
      client ??
      new Stripe(config.secretKey, { apiVersion: '2026-08-26.dahlia', timeout: 10000, maxNetworkRetries: 2 });
  }
  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch {
      throw failure();
    }
  }
  private async platform() {
    const account = parse(
      z.object({ id: id('acct'), object: z.literal('account') }),
      await this.call(() => this.client.accounts.retrieve(null)),
    );
    if (account.id !== this.config.platformAccountId) throw failure();
  }
  async retrieve(raw: PaymentReference) {
    const r = parse(Payment, raw);
    await this.platform();
    const p = parse(
      Intent,
      await this.call(() =>
        this.client.paymentIntents.retrieve(r.intentId, {
          expand: ['latest_charge.balance_transaction'],
        }),
      ),
    );
    const c = p.latest_charge;
    const b = c.balance_transaction;
    if (
      p.id !== r.intentId ||
      p.livemode !== this.config.live ||
      p.customer !== r.customerId ||
      p.metadata.roveRideId !== r.rideId ||
      p.metadata.roveAttemptId !== r.attemptId ||
      p.amount !== r.amountCents ||
      p.amount_received !== r.amountCents ||
      c.livemode !== this.config.live ||
      c.payment_intent !== r.intentId ||
      c.amount !== r.amountCents ||
      c.amount_captured !== r.amountCents ||
      c.amount_refunded > c.amount_captured ||
      b.source !== c.id ||
      !['charge', 'payment'].includes(b.type) ||
      b.fee < 0 ||
      b.fee > b.amount ||
      b.amount !== c.amount_captured
    )
      throw failure();
    return {
      chargeId: c.id,
      balanceId: b.id,
      amountCents: b.amount,
      feeCents: b.fee,
      netCents: b.net,
      status: b.status,
      disputed: c.disputed,
      unrefundedCents: c.amount_captured - c.amount_refunded,
    };
  }
}
