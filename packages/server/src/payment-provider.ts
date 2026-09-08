/** Provider boundary. Amounts and references must come from persisted server-owned records. */
export interface PaymentReference {
  intentId: string;
  rideId: string;
  attemptId: string;
  customerId: string;
  amountCents: number;
}
export interface PaymentSnapshot extends PaymentReference {
  status:
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'requires_action'
    | 'processing'
    | 'requires_capture'
    | 'canceled'
    | 'succeeded';
  capturableCents: number;
  receivedCents: number;
}
export interface PaymentProvider {
  create(
    input: Omit<PaymentReference, 'intentId'>,
    key: string,
  ): Promise<{ payment: PaymentSnapshot; clientSecret: string }>;
  retrieve(reference: PaymentReference): Promise<PaymentSnapshot>;
  session(reference: PaymentReference): Promise<{ payment: PaymentSnapshot; clientSecret: string }>;
  capture(reference: PaymentReference, amountCents: number, key: string): Promise<PaymentSnapshot>;
  cancel(reference: PaymentReference, key: string): Promise<PaymentSnapshot>;
  refund(
    reference: PaymentReference,
    amountCents: number,
    key: string,
  ): Promise<{
    id: string;
    status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';
    amountCents: number;
  }>;
}

export interface PaymentCustomerProvider {
  createCustomer(reference: { riderId: string; bindingId: string }, key: string): Promise<string>;
}
