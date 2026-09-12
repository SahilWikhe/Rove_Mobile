import { DisputeSnapshot, DisputeId } from './disputes';
import Stripe from 'stripe';
import { z } from 'zod';
import { DomainError } from './errors';
import type {
  PaymentCustomerProvider,
  PaymentProvider,
  PaymentReference,
  PaymentSnapshot,
  RefundProvider,
  RefundSnapshot,
} from './payment-provider';

const MinorAmount = z.number().int().min(1).max(99_999_999);
const Amount = MinorAmount.min(50);
const Customer = z
  .string()
  .regex(/^cus_[a-zA-Z0-9]+$/)
  .max(100);
const IntentId = z
  .string()
  .regex(/^pi_[a-zA-Z0-9]+$/)
  .max(100);
const Key = z.string().regex(/^[a-zA-Z0-9:_/-]{8,255}$/);
const CreateInput = z
  .object({ rideId: z.uuid(), attemptId: z.uuid(), customerId: Customer, amountCents: Amount })
  .strict();
const Reference = CreateInput.extend({ intentId: IntentId });
const Intent = z.object({
  id: IntentId,
  object: z.literal('payment_intent'),
  livemode: z.boolean(),
  amount: Amount,
  currency: z.literal('usd'),
  capture_method: z.literal('manual'),
  customer: z.union([Customer, z.object({ id: Customer })]),
  metadata: z.object({ roveRideId: z.uuid(), roveAttemptId: z.uuid() }),
  status: z.enum([
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
    'processing',
    'requires_capture',
    'canceled',
    'succeeded',
  ]),
  amount_capturable: z.number().int().min(0),
  amount_received: z.number().int().min(0),
  client_secret: z.string().nullable().optional(),
});
type StripeApi = Pick<Stripe, 'paymentIntents' | 'refunds' | 'webhooks' | 'customers' | 'disputes'>;
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new DomainError('INVALID_PAYMENT_REQUEST', 'Check payment request details.', 422);
  return parsed.data;
}
const mismatch = () => new DomainError('PAYMENT_REFERENCE_MISMATCH', 'Payment could not be verified.', 503);

/** Platform PaymentIntents adapter. Connect transfers/payouts require a separately approved charge model. */
export class StripePaymentProvider implements PaymentProvider, PaymentCustomerProvider, RefundProvider {
  private stripe: StripeApi;
  constructor(
    private config: {
      secretKey: string;
      webhookSecret: string;
      live: boolean;
      paymentMethodConfiguration: string;
    },
    client?: StripeApi,
  ) {
    const mode = config.live ? 'live' : 'test';
    if (
      !new RegExp(`^(sk|rk)_${mode}_[a-zA-Z0-9]+$`).test(config.secretKey) ||
      !config.webhookSecret.startsWith('whsec_') ||
      !/^pmc_[a-zA-Z0-9]{1,96}$/.test(config.paymentMethodConfiguration)
    )
      throw new Error('Stripe credentials do not match the configured environment.');
    this.stripe =
      client ??
      new Stripe(config.secretKey, {
        apiVersion: '2026-08-26.dahlia',
        timeout: 10_000,
        maxNetworkRetries: 2,
      });
  }
  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch {
      // Provider errors can contain request/card details and client secrets. Do not propagate them.
      throw new DomainError(
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'Payment could not be confirmed. Please try again shortly.',
        503,
      );
    }
  }
  private snapshot(
    raw: unknown,
    reference: Omit<PaymentReference, 'intentId'> & { intentId?: string },
  ): PaymentSnapshot {
    const parsed = Intent.safeParse(raw);
    if (!parsed.success) throw mismatch();
    const value = parsed.data;
    const customerId = typeof value.customer === 'string' ? value.customer : value.customer.id;
    if (
      value.livemode !== this.config.live ||
      customerId !== reference.customerId ||
      value.amount !== reference.amountCents ||
      value.metadata.roveRideId !== reference.rideId ||
      value.metadata.roveAttemptId !== reference.attemptId ||
      (reference.intentId && value.id !== reference.intentId) ||
      value.amount_capturable > value.amount ||
      value.amount_received > value.amount
    )
      throw mismatch();
    return {
      intentId: value.id,
      rideId: reference.rideId,
      attemptId: reference.attemptId,
      customerId,
      amountCents: value.amount,
      status: value.status,
      capturableCents: value.amount_capturable,
      receivedCents: value.amount_received,
    };
  }
  async createCustomer(raw: { riderId: string; bindingId: string }, key: string) {
    const reference = input(z.object({ riderId: z.uuid(), bindingId: z.uuid() }).strict(), raw);
    input(Key, key);
    const result = await this.call(() =>
      this.stripe.customers.create(
        {
          metadata: { roveRiderId: reference.riderId, roveBindingId: reference.bindingId },
        },
        { idempotencyKey: key },
      ),
    );
    const customer = z
      .object({
        id: Customer,
        object: z.literal('customer'),
        livemode: z.boolean(),
        metadata: z.object({ roveRiderId: z.uuid(), roveBindingId: z.uuid() }),
      })
      .safeParse(result);
    if (
      !customer.success ||
      customer.data.livemode !== this.config.live ||
      customer.data.metadata.roveRiderId !== reference.riderId ||
      customer.data.metadata.roveBindingId !== reference.bindingId
    )
      throw mismatch();
    return customer.data.id;
  }
  async create(raw: Omit<PaymentReference, 'intentId'>, key: string) {
    const request = input(CreateInput, raw);
    input(Key, key);
    const result = await this.call(() =>
      this.stripe.paymentIntents.create(
        {
          amount: request.amountCents,
          currency: 'usd',
          customer: request.customerId,
          capture_method: 'manual',
          payment_method_configuration: this.config.paymentMethodConfiguration,
          metadata: { roveRideId: request.rideId, roveAttemptId: request.attemptId },
        },
        { idempotencyKey: key },
      ),
    );
    const payment = this.snapshot(result, request);
    if (!result.client_secret || !result.client_secret.startsWith(payment.intentId + '_secret_'))
      throw mismatch();
    // This secret is for the authenticated owner's PaymentSheet only. Never put it in logs/outbox.
    return { payment, clientSecret: result.client_secret };
  }
  async retrieve(raw: PaymentReference) {
    const reference = input(Reference, raw);
    return this.snapshot(
      await this.call(() => this.stripe.paymentIntents.retrieve(reference.intentId)),
      reference,
    );
  }
  async session(raw: PaymentReference) {
    const reference = input(Reference, raw);
    const result = await this.call(() => this.stripe.paymentIntents.retrieve(reference.intentId));
    const payment = this.snapshot(result, reference);
    if (!result.client_secret || !result.client_secret.startsWith(payment.intentId + '_secret_'))
      throw mismatch();
    return { payment, clientSecret: result.client_secret };
  }
  async capture(raw: PaymentReference, amountCents: number, key: string) {
    const reference = input(Reference, raw);
    input(MinorAmount, amountCents);
    input(Key, key);
    if (amountCents > reference.amountCents)
      throw new DomainError('INVALID_CAPTURE_AMOUNT', 'Capture exceeds the authorized fare.', 422);
    const current = await this.retrieve(reference);
    if (current.status === 'succeeded' && current.receivedCents === amountCents) return current;
    if (current.status !== 'requires_capture' || current.capturableCents < amountCents)
      throw new DomainError('PAYMENT_NOT_CAPTURABLE', 'Payment is not available for capture.', 409);
    const payment = this.snapshot(
      await this.call(() =>
        this.stripe.paymentIntents.capture(
          reference.intentId,
          // Ordinary ride payments use one capture; Stripe rejects multicapture-only options.
          { amount_to_capture: amountCents },
          { idempotencyKey: key },
        ),
      ),
      reference,
    );
    if (payment.status === 'succeeded' && payment.receivedCents !== amountCents) throw mismatch();
    return payment;
  }
  async cancel(raw: PaymentReference, key: string) {
    const reference = input(Reference, raw);
    input(Key, key);
    const current = await this.retrieve(reference);
    if (current.status === 'canceled') return current;
    if (current.status === 'succeeded')
      throw new DomainError('PAYMENT_ALREADY_CAPTURED', 'Captured payment requires a refund decision.', 409);
    return this.snapshot(
      await this.call(() =>
        this.stripe.paymentIntents.cancel(reference.intentId, {}, { idempotencyKey: key }),
      ),
      reference,
    );
  }
  async refund(raw: PaymentReference, amountCents: number, key: string) {
    const reference = input(Reference, raw);
    input(MinorAmount, amountCents);
    input(Key, key);
    if (amountCents > reference.amountCents)
      throw new DomainError('INVALID_REFUND_AMOUNT', 'Refund exceeds the original fare.', 422);
    const current = await this.retrieve(reference);
    if (current.status !== 'succeeded' || amountCents > current.receivedCents)
      throw new DomainError('PAYMENT_NOT_REFUNDABLE', 'Payment is not available for refund.', 409);
    const result = await this.call(() =>
      this.stripe.refunds.create(
        {
          payment_intent: reference.intentId,
          amount: amountCents,
          metadata: {
            roveRideId: reference.rideId,
            roveAttemptId: reference.attemptId,
            ...(key.startsWith('rove-refund:') && z.uuid().safeParse(key.slice(12)).success
              ? { roveRefundOperationId: key.slice(12) }
              : {}),
          },
        },
        { idempotencyKey: key },
      ),
    );
    const parsed = z
      .object({
        id: z.string().regex(/^re_[a-zA-Z0-9]+$/),
        amount: MinorAmount,
        currency: z.literal('usd'),
        payment_intent: z.union([IntentId, z.object({ id: IntentId })]),
        status: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']),
      })
      .safeParse(result);
    if (
      !parsed.success ||
      parsed.data.amount !== amountCents ||
      (typeof parsed.data.payment_intent === 'string'
        ? parsed.data.payment_intent
        : parsed.data.payment_intent.id) !== reference.intentId
    )
      throw mismatch();
    return { id: parsed.data.id, status: parsed.data.status, amountCents: parsed.data.amount };
  }
  /** Read every bounded page; never turn a truncated or unverifiable list into a refund total. */
  async refunds(raw: PaymentReference) {
    const reference = input(Reference, raw);
    const payment = await this.retrieve(reference);
    const Balance = z.object({
      id: z.string().regex(/^txn_[a-zA-Z0-9]{1,96}$/),
      object: z.literal('balance_transaction'),
      source: z.union([z.string(), z.object({ id: z.string() })]),
      currency: z.literal('usd'),
      type: z.enum(['refund', 'payment_refund', 'refund_failure']),
      amount: z.number().int().min(-99_999_999).max(99_999_999),
      fee: z.number().int().min(-99_999_999).max(99_999_999),
      net: z.number().int().min(-199_999_998).max(199_999_998),
    });
    const Refund = z.object({
      id: z.string().regex(/^re_[a-zA-Z0-9]{1,96}$/),
      object: z.literal('refund'),
      payment_intent: z.union([IntentId, z.object({ id: IntentId })]),
      amount: MinorAmount,
      currency: z.literal('usd'),
      status: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']),
      created: z.number().int().min(0).max(2_147_483_647),
      metadata: z.object({ roveRefundOperationId: z.uuid().optional() }).nullish(),
      balance_transaction: Balance.nullish(),
      failure_balance_transaction: Balance.nullish(),
    });
    const Page = z.object({
      object: z.literal('list'),
      data: z.array(Refund).max(100),
      has_more: z.boolean(),
    });
    const refunds: RefundSnapshot[] = [];
    const seen = new Set<string>();
    const seenBalances = new Set<string>();
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
      const result = await this.call(() =>
        this.stripe.refunds.list({
          payment_intent: reference.intentId,
          limit: 100,
          expand: ['data.balance_transaction', 'data.failure_balance_transaction'],
          ...(cursor ? { starting_after: cursor } : {}),
        }),
      );
      const parsed = Page.safeParse(result);
      if (!parsed.success) throw mismatch();
      for (const item of parsed.data.data) {
        const intentId =
          typeof item.payment_intent === 'string' ? item.payment_intent : item.payment_intent.id;
        if (intentId !== reference.intentId || seen.has(item.id) || item.amount > payment.receivedCents)
          throw mismatch();
        seen.add(item.id);
        const balances: NonNullable<RefundSnapshot['balanceTransactions']> = [];
        for (const [kind, balance] of [
          ['refund', item.balance_transaction],
          ['refund_failure', item.failure_balance_transaction],
        ] as const) {
          if (!balance) continue;
          if (seenBalances.has(balance.id)) throw mismatch();
          seenBalances.add(balance.id);
          if (
            (typeof balance.source === 'string' ? balance.source : balance.source.id) !== item.id ||
            balance.amount !== (kind === 'refund' ? -item.amount : item.amount) ||
            balance.net !== balance.amount - balance.fee ||
            (kind === 'refund_failure'
              ? balance.type !== 'refund_failure'
              : !['refund', 'payment_refund'].includes(balance.type))
          )
            throw mismatch();
          balances.push({
            id: balance.id,
            refundId: item.id,
            kind,
            amountCents: balance.amount,
            feeCents: balance.fee,
            netCents: balance.net,
          });
        }
        if (item.failure_balance_transaction && !item.balance_transaction) throw mismatch();
        refunds.push({
          id: item.id,
          balanceTransactions: balances,
          intentId,
          amountCents: item.amount,
          status: item.status,
          created: item.created,
          ...(item.metadata?.roveRefundOperationId
            ? { operationId: item.metadata.roveRefundOperationId }
            : {}),
        });
      }
      const committed = refunds
        .filter((item) => ['pending', 'requires_action', 'succeeded'].includes(item.status))
        .reduce((total, item) => total + item.amountCents, 0);
      if (committed > payment.receivedCents) throw mismatch();
      if (!parsed.data.has_more) return { payment, refunds };
      if (!parsed.data.data.length) throw mismatch();
      cursor = parsed.data.data.at(-1)!.id;
    }
    throw new DomainError(
      'PAYMENT_REFUND_REVIEW_REQUIRED',
      'Refund history requires review before it can be confirmed.',
      503,
    );
  }
  async disputes(raw: PaymentReference) {
    const reference = input(Reference, raw),
      payment = await this.retrieve(reference);
    const Balance = z.object({
      id: z.string().regex(/^txn_[a-zA-Z0-9]{1,96}$/),
      source: z.union([DisputeId, z.object({ id: DisputeId })]),
      currency: z.literal('usd'),
      type: z.literal('adjustment'),
      amount: z.number().int().min(-99_999_999).max(99_999_999),
      fee: z.number().int().min(-99_999_999).max(99_999_999),
      net: z.number().int().min(-199_999_998).max(199_999_998),
    });
    const Item = z.object({
      id: DisputeId,
      object: z.literal('dispute'),
      livemode: z.literal(this.config.live),
      payment_intent: z.union([IntentId, z.object({ id: IntentId })]),
      currency: z.literal('usd'),
      amount: MinorAmount,
      status: DisputeSnapshot.shape.status,
      reason: DisputeSnapshot.shape.reason,
      created: DisputeSnapshot.shape.created,
      evidence_details: z.object({ due_by: z.number().int().min(0).max(2147483647).nullish() }),
      balance_transactions: z.array(Balance).max(2),
    });
    const Page = z.object({ object: z.literal('list'), data: z.array(Item).max(100), has_more: z.boolean() });
    const disputes: DisputeSnapshot[] = [];
    const seen = new Set<string>(),
      balances = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const response = await this.call(() =>
        this.stripe.disputes.list({
          payment_intent: reference.intentId,
          limit: 100,
          ...(cursor ? { starting_after: cursor } : {}),
        }),
      );
      const parsed = Page.safeParse(response);
      if (!parsed.success) throw mismatch();
      for (const item of parsed.data.data) {
        const intentId =
          typeof item.payment_intent === 'string' ? item.payment_intent : item.payment_intent.id;
        if (intentId !== reference.intentId || seen.has(item.id)) throw mismatch();
        seen.add(item.id);
        const movements = item.balance_transactions.map((balance) => {
          if (
            (typeof balance.source === 'string' ? balance.source : balance.source.id) !== item.id ||
            balance.net !== balance.amount - balance.fee ||
            balances.has(balance.id)
          )
            throw mismatch();
          balances.add(balance.id);
          return {
            id: balance.id,
            disputeId: item.id,
            amountCents: balance.amount,
            feeCents: balance.fee,
            netCents: balance.net,
          };
        });
        disputes.push(
          DisputeSnapshot.parse({
            id: item.id,
            intentId,
            amountCents: item.amount,
            status: item.status,
            reason: item.reason,
            created: item.created,
            dueBy: item.evidence_details.due_by ?? null,
            balanceTransactions: movements,
          }),
        );
      }
      if (!parsed.data.has_more) return { payment, disputes };
      if (!parsed.data.data.length) throw mismatch();
      cursor = parsed.data.data.at(-1)!.id;
    }
    throw new DomainError('DISPUTE_REVIEW_REQUIRED', 'Complete dispute history could not be verified.', 503);
  }
  verifyWebhook(body: string | Buffer, signature: string, now = Date.now()) {
    if (Buffer.byteLength(body) > 1_048_576 || signature.length > 8192)
      throw new DomainError('INVALID_PAYMENT_WEBHOOK', 'Invalid payment event.', 400);
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(body, signature, this.config.webhookSecret, 300);
      const timestamp = Number(/(?:^|,)t=(\d+)(?:,|$)/.exec(signature)?.[1]);
      if (
        !Number.isFinite(timestamp) ||
        Math.abs(now / 1000 - timestamp) > 300 ||
        event.livemode !== this.config.live ||
        event.account !== undefined
      )
        throw new Error('Invalid event environment or timestamp');
    } catch {
      throw new DomainError('INVALID_PAYMENT_WEBHOOK', 'Invalid payment event.', 400);
    }
    // Signed event is a reconciliation hint, not permission to trust client state or old event order.
    const parsed = z
      .object({
        id: z.string().regex(/^evt_[a-zA-Z0-9]+$/),
        type: z.string().max(100),
        created: z.number().int(),
        data: z.object({ object: z.object({ id: z.string().max(100) }) }),
      })
      .safeParse(event);
    if (!parsed.success) throw new DomainError('INVALID_PAYMENT_WEBHOOK', 'Invalid payment event.', 400);
    let resourceId = parsed.data.data.object.id;
    if (
      [
        'charge.dispute.created',
        'charge.dispute.updated',
        'charge.dispute.closed',
        'charge.dispute.funds_withdrawn',
        'charge.dispute.funds_reinstated',
      ].includes(parsed.data.type)
    ) {
      const dispute = z
        .object({
          object: z.literal('dispute'),
          id: DisputeId,
          payment_intent: z.union([IntentId, z.object({ id: IntentId }), z.null()]),
        })
        .safeParse(event.data.object);
      if (!dispute.success) throw new DomainError('INVALID_PAYMENT_WEBHOOK', 'Invalid payment event.', 400);
      if (dispute.data.payment_intent === null)
        return {
          id: parsed.data.id,
          type: 'dispute.unlinked',
          created: parsed.data.created,
          resourceId: dispute.data.id,
        };
      resourceId =
        typeof dispute.data.payment_intent === 'string'
          ? dispute.data.payment_intent
          : dispute.data.payment_intent.id;
    }
    if (['refund.created', 'refund.updated', 'refund.failed'].includes(parsed.data.type)) {
      const refund = z
        .object({
          object: z.literal('refund'),
          id: z.string().regex(/^re_[a-zA-Z0-9]{1,96}$/),
          payment_intent: z.union([IntentId, z.object({ id: IntentId }), z.null()]),
        })
        .safeParse(event.data.object);
      if (!refund.success) throw new DomainError('INVALID_PAYMENT_WEBHOOK', 'Invalid payment event.', 400);
      // Valid legacy charge refunds have no PaymentIntent and cannot belong to a Rove attempt.
      if (refund.data.payment_intent === null)
        return {
          id: parsed.data.id,
          type: 'refund.unlinked',
          created: parsed.data.created,
          resourceId: refund.data.id,
        };
      resourceId =
        typeof refund.data.payment_intent === 'string'
          ? refund.data.payment_intent
          : refund.data.payment_intent.id;
    }
    return { id: parsed.data.id, type: parsed.data.type, created: parsed.data.created, resourceId };
  }
}
