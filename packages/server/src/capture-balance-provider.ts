import type { PaymentReference } from './payment-provider';

export interface CaptureBalanceSnapshot {
  chargeId: string;
  balanceId: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  status: 'pending' | 'available';
  disputed: boolean;
  unrefundedCents: number;
}
export interface CaptureBalanceProvider {
  retrieve(reference: PaymentReference): Promise<CaptureBalanceSnapshot>;
}
