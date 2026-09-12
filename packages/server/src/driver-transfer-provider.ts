import type { PaymentReference } from './payment-provider';

/** All references/amounts must come from a durable, authorized server reservation. */
export interface DriverTransferReference {
  operationId: string;
  /** Persisted before the first provider mutation; never reset on retries. */
  firstAttemptAt: string;
  driverId: string;
  bindingId: string;
  accountId: string;
  chargeId: string;
  amountCents: number;
  payment: PaymentReference;
}
export interface DriverTransferSnapshot {
  id: string;
  created: number;
  amountCents: number;
  reversedCents: number;
  movements: {
    id: string;
    sourceId: string;
    kind: 'transfer' | 'transfer_refund';
    amountCents: number;
    feeCents: number;
    netCents: number;
  }[];
}
export interface DriverTransferProvider {
  funding(payment: PaymentReference): Promise<{ chargeId: string; unrefundedCents: number }>;
  create(reference: DriverTransferReference): Promise<DriverTransferSnapshot>;
  find(reference: DriverTransferReference): Promise<DriverTransferSnapshot | null>;
  retrieve(reference: DriverTransferReference, id: string): Promise<DriverTransferSnapshot>;
}
