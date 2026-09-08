import Stripe from 'stripe';
import { z } from 'zod';
import { DomainError } from './errors';
import type { PaymentProvider, PaymentReference, PaymentSnapshot } from './payment-provider';

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
type StripeApi = Pick<Stripe, 'paymentIntents' | 'refunds' | 'webhooks'>;
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new DomainError('INVALID_PAYMENT_REQUEST', 'Check payment request details.', 422);
  return parsed.data;
}
const mismatch = () => new DomainError('PAYMENT_REFERENCE_MISMATCH', 'Payment could not be verified.', 503);

/** Platform PaymentIntents adapter. Connect transfers/payouts require a separately approved charge model. */
export class StripePaymentProvider implements PaymentProvider {
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
          { amount_to_capture: amountCents, final_capture: true },
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
          metadata: { roveRideId: reference.rideId, roveAttemptId: reference.attemptId },
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
    return {
      id: parsed.data.id,
      type: parsed.data.type,
      created: parsed.data.created,
      resourceId: parsed.data.data.object.id,
    };
  }
}
