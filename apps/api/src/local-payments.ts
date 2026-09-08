import type {
  PaymentProvider,
  PaymentCustomerProvider,
  PaymentReference,
  PaymentSnapshot,
} from '@rove/server';

/** In-memory provider for the disposable local runtime only. Never contacts Stripe. */
export class LocalPayments implements PaymentProvider, PaymentCustomerProvider {
  private payments = new Map<string, PaymentSnapshot>();
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
  async refund(): Promise<never> {
    throw new Error('Synthetic refunds are not implemented.');
  }
}
