import { randomUUID } from 'node:crypto';
import type {
  PaymentProvider,
  PaymentCustomerProvider,
  PaymentReference,
  PaymentSnapshot,
} from '@rove/server';

/** In-memory provider for the disposable local runtime only. Never contacts Stripe. */
export class LocalPayments implements PaymentProvider, PaymentCustomerProvider {
  private payments = new Map<string, PaymentSnapshot>();
  private refunds = new Map<
    string,
    { intentId: string; result: { id: string; status: 'succeeded'; amountCents: number } }
  >();
  private refundedCents = new Map<string, number>();
  constructor() {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL)
      throw new Error('Synthetic payments cannot run in a deployment.');
  }
  async createCustomer(reference: { bindingId: string }) {
    return 'cus_synthetic' + reference.bindingId.replaceAll('-', '');
  }
  async create(input: Omit<PaymentReference, 'intentId'>) {
    const intentId = 'pi_synthetic' + input.attemptId.replaceAll('-', '');
    if (!this.payments.has(intentId))
      this.payments.set(intentId, {
        ...input,
        intentId,
        status: 'requires_capture',
        capturableCents: input.amountCents,
        receivedCents: 0,
      });
    return this.session({ ...input, intentId });
  }
  async retrieve(reference: PaymentReference) {
    const payment = this.payments.get(reference.intentId);
    if (
      !payment ||
      Object.entries(reference).some(([key, value]) => payment[key as keyof PaymentReference] !== value)
    )
      throw new Error('Synthetic payment reference mismatch.');
    return { ...payment };
  }
  async session(reference: PaymentReference) {
    return {
      payment: await this.retrieve(reference),
      clientSecret: reference.intentId + '_secret_synthetic',
    };
  }
  async capture(reference: PaymentReference, amountCents: number) {
    const payment = await this.retrieve(reference);
    if (amountCents !== reference.amountCents || !['requires_capture', 'succeeded'].includes(payment.status))
      throw new Error('Synthetic capture is not available.');
    const updated = {
      ...payment,
      status: 'succeeded' as const,
      capturableCents: 0,
      receivedCents: amountCents,
    };
    this.payments.set(reference.intentId, updated);
    return { ...updated };
  }
  async cancel(reference: PaymentReference) {
    const payment = await this.retrieve(reference);
    if (payment.status === 'succeeded') throw new Error('A captured synthetic payment cannot be canceled.');
    const updated = { ...payment, status: 'canceled' as const, capturableCents: 0 };
    this.payments.set(reference.intentId, updated);
    return { ...updated };
  }
  async refund(reference: PaymentReference, amountCents: number, key: string) {
    const payment = await this.retrieve(reference);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !key.trim())
      throw new Error('Invalid synthetic refund request.');
    const prior = this.refunds.get(key);
    if (prior) {
      if (prior.intentId !== reference.intentId || prior.result.amountCents !== amountCents)
        throw new Error('Synthetic refund retry mismatch.');
      return { ...prior.result };
    }
    const refunded = this.refundedCents.get(reference.intentId) ?? 0;
    if (payment.status !== 'succeeded' || amountCents > payment.receivedCents - refunded)
      throw new Error('Synthetic payment is not available for this refund.');
    // No await between checking and recording: concurrent requests cannot overspend the balance.
    const result = {
      id: 're_synthetic' + randomUUID().replaceAll('-', ''),
      status: 'succeeded' as const,
      amountCents,
    };
    this.refunds.set(key, { intentId: reference.intentId, result });
    this.refundedCents.set(reference.intentId, refunded + amountCents);
    return { ...result };
  }
}
