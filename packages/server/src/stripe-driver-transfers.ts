import Stripe from 'stripe';
import { StripeCaptureBalances } from './stripe-capture-balances';
import { z } from 'zod';
import { DomainError } from './errors';
import type { DriverPayoutProvider } from './driver-payout-provider';
import type { PaymentReference } from './payment-provider';
import type {
  DriverTransferProvider,
  DriverTransferReference,
  DriverTransferSnapshot,
} from './driver-transfer-provider';

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
const Reference = z.object({
  operationId: z.uuid(),
  firstAttemptAt: z.iso.datetime(),
  driverId: z.uuid(),
  bindingId: z.uuid(),
  accountId: id('acct'),
  chargeId: id('ch'),
  amountCents: Amount,
  payment: Payment,
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
const Transfer = z.object({
  id: id('tr'),
  object: z.literal('transfer'),
  livemode: z.boolean(),
  amount: Amount,
  amount_reversed: NonnegativeAmount,
  reversed: z.boolean(),
  currency: z.literal('usd'),
  created: z.number().int().positive(),
  destination: id('acct'),
  source_transaction: id('ch'),
  transfer_group: z.string(),
  metadata: z.record(z.string(), z.string()),
  balance_transaction: Balance,
});
const Reversal = z.object({
  id: id('trr'),
  object: z.literal('transfer_reversal'),
  amount: Amount,
  currency: z.literal('usd'),
  transfer: id('tr'),
  balance_transaction: Balance,
});
const Page = z.object({
  object: z.literal('list'),
  data: z.array(z.unknown()).max(100),
  has_more: z.boolean(),
});
export type TransferClient = Pick<Stripe, 'accounts' | 'paymentIntents' | 'transfers'>;
const failure = () =>
  new DomainError('TRANSFER_PROVIDER_UNAVAILABLE', 'Driver transfer could not be verified.', 503);
const hold = () => new DomainError('TRANSFER_FUNDING_HOLD', 'Driver transfer funding is not ready.', 409);
const group = (r: DriverTransferReference) => `rove_transfer_${r.operationId}`;
const metadata = (r: DriverTransferReference) => ({
  roveTransferOperationId: r.operationId,
  roveDriverId: r.driverId,
  roveBindingId: r.bindingId,
  roveRideId: r.payment.rideId,
  roveAttemptId: r.payment.attemptId,
});
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw failure();
  return result.data;
}

/** Provider transport used by the opt-in durable transfer workflow.
 * A transfer credits the connected Stripe account, not the driver's bank account.
 */
export class StripeDriverTransfers implements DriverTransferProvider {
  private client: TransferClient;
  constructor(
    private config: { secretKey: string; live: boolean; platformAccountId: string },
    private recipient: Pick<DriverPayoutProvider, 'status'>,
    client?: TransferClient,
    private now: () => Date = () => new Date(),
  ) {
    if (
      !new RegExp(`^(sk|rk)_${config.live ? 'live' : 'test'}_[a-zA-Z0-9]+$`).test(config.secretKey) ||
      !id('acct').safeParse(config.platformAccountId).success
    )
      throw new Error('Invalid transfer configuration.');
    this.client =
      client ??
      new Stripe(config.secretKey, {
        apiVersion: '2026-08-26.dahlia',
        timeout: 10000,
        maxNetworkRetries: 2,
      });
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
  async funding(raw: PaymentReference) {
    const capture = await this.call(() => new StripeCaptureBalances(this.config, this.client).retrieve(raw));
    if (capture.status !== 'available' || capture.disputed) throw hold();
    return { chargeId: capture.chargeId, unrefundedCents: capture.unrefundedCents };
  }
  private reference(raw: DriverTransferReference) {
    const r = parse(Reference, raw);
    if (r.accountId === this.config.platformAccountId || r.amountCents > r.payment.amountCents)
      throw failure();
    return r;
  }
  private retryWindow(r: DriverTransferReference) {
    const age = this.now().getTime() - Date.parse(r.firstAttemptAt);
    if (age < 0 || age >= 23 * 60 * 60 * 1000) {
      throw new DomainError(
        'TRANSFER_REVIEW_REQUIRED',
        'Recover the previous transfer outcome before retrying.',
        409,
      );
    }
  }
  async create(raw: DriverTransferReference) {
    const r = this.reference(raw);
    this.retryWindow(r);
    const funds = await this.funding(r.payment);
    if (funds.chargeId !== r.chargeId || funds.unrefundedCents < r.amountCents) throw hold();
    const ready = await this.call(() =>
      this.recipient.status({
        driverId: r.driverId,
        bindingId: r.bindingId,
        accountId: r.accountId,
      }),
    );
    if (ready !== 'ready') throw hold();
    this.retryWindow(r);
    const result = await this.call(() =>
      this.client.transfers.create(
        {
          amount: r.amountCents,
          currency: 'usd',
          destination: r.accountId,
          source_transaction: r.chargeId,
          transfer_group: group(r),
          metadata: metadata(r),
          expand: ['balance_transaction'],
        },
        { idempotencyKey: `rove-transfer:${r.operationId}` },
      ),
    );
    return this.snapshot(r, result);
  }
  async find(raw: DriverTransferReference) {
    const r = this.reference(raw);
    await this.platform();
    const page = parse(
      Page,
      await this.call(() =>
        this.client.transfers.list({
          destination: r.accountId,
          transfer_group: group(r),
          limit: 2,
          expand: ['data.balance_transaction'],
        }),
      ),
    );
    // An operation has exactly one transfer. Never guess by amount or accept a partial result.
    if (page.has_more || page.data.length > 1) throw failure();
    return page.data.length ? this.snapshot(r, page.data[0]) : null;
  }
  async retrieve(raw: DriverTransferReference, transferId: string) {
    const r = this.reference(raw);
    parse(id('tr'), transferId);
    await this.platform();
    return this.snapshot(
      r,
      await this.call(() =>
        this.client.transfers.retrieve(transferId, {
          expand: ['balance_transaction'],
        }),
      ),
      transferId,
    );
  }
  private movement(
    raw: z.infer<typeof Balance>,
    sourceId: string,
    kind: 'transfer' | 'transfer_refund',
    amount: number,
  ) {
    if (raw.source !== sourceId || raw.type !== kind || raw.amount !== amount) throw failure();
    return { id: raw.id, sourceId, kind, amountCents: raw.amount, feeCents: raw.fee, netCents: raw.net };
  }
  private async snapshot(
    r: DriverTransferReference,
    raw: unknown,
    expectedId?: string,
  ): Promise<DriverTransferSnapshot> {
    const t = parse(Transfer, raw);
    if (
      (expectedId && t.id !== expectedId) ||
      t.livemode !== this.config.live ||
      t.created * 1000 < Date.parse(r.firstAttemptAt) - 10_000 ||
      t.created * 1000 > this.now().getTime() + 10_000 ||
      t.amount !== r.amountCents ||
      t.amount_reversed > t.amount ||
      t.reversed !== (t.amount_reversed === t.amount) ||
      t.destination !== r.accountId ||
      t.source_transaction !== r.chargeId ||
      t.transfer_group !== group(r) ||
      Object.entries(metadata(r)).some(([key, value]) => t.metadata[key] !== value)
    )
      throw failure();
    const movements = [this.movement(t.balance_transaction, t.id, 'transfer', -t.amount)];
    const seen = new Set<string>();
    let total = 0,
      cursor: string | undefined;
    // Always read reversal history, even for zero: a concurrently changed total fails closed and retries.
    for (let n = 0; n < 10; n++) {
      const page = parse(
        Page,
        await this.call(() =>
          this.client.transfers.listReversals(t.id, {
            limit: 100,
            ...(cursor ? { starting_after: cursor } : {}),
            expand: ['data.balance_transaction'],
          }),
        ),
      );
      for (const rawReversal of page.data) {
        const v = parse(Reversal, rawReversal);
        if (v.transfer !== t.id || seen.has(v.id)) throw failure();
        seen.add(v.id);
        cursor = v.id;
        total += v.amount;
        if (total > t.amount_reversed) throw failure();
        movements.push(this.movement(v.balance_transaction, v.id, 'transfer_refund', v.amount));
      }
      if (!page.has_more) {
        if (total !== t.amount_reversed || new Set(movements.map((m) => m.id)).size !== movements.length)
          throw failure();
        return { id: t.id, created: t.created, amountCents: t.amount, reversedCents: total, movements };
      }
      if (!page.data.length) throw failure();
    }
    throw failure();
  }
}
